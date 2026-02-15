"""FastAPI entry point for the drone control server."""

import logging
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import HTMLResponse, Response

from config import WS_HOST, WS_PORT
from ws_handler import ConnectionManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Drone Control Server starting on %s:%d", WS_HOST, WS_PORT)
    yield


app = FastAPI(title="Drone Control Server", lifespan=lifespan)


http_client = httpx.AsyncClient(timeout=15.0)


@app.get("/health")
async def health():
    return {"status": "ok", "state": manager.sm.state.value}


@app.get("/geocode")
async def geocode(q: str = Query(...)):
    """Proxy Nominatim geocoding for phone (no internet on phone)."""
    url = f"https://nominatim.openstreetmap.org/search?format=json&q={q}&limit=5&addressdetails=1"
    resp = await http_client.get(url, headers={"User-Agent": "DroneControl/1.0"})
    return Response(content=resp.content, media_type="application/json")


@app.get("/route")
async def route(
    from_lat: float = Query(...), from_lng: float = Query(...),
    to_lat: float = Query(...), to_lng: float = Query(...),
):
    """Proxy OSRM routing for phone."""
    url = f"https://router.project-osrm.org/route/v1/driving/{from_lng},{from_lat};{to_lng},{to_lat}?overview=full&geometries=geojson&steps=true"
    resp = await http_client.get(url)
    return Response(content=resp.content, media_type="application/json")


@app.get("/reverse-geocode")
async def reverse_geocode(lat: float = Query(...), lon: float = Query(...)):
    """Proxy Nominatim reverse geocoding for phone."""
    url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}"
    resp = await http_client.get(url, headers={"User-Agent": "DroneControl/1.0"})
    return Response(content=resp.content, media_type="application/json")


@app.get("/tile/{z}/{x}/{y}.png")
async def map_tile(z: int, x: int, y: int):
    """Proxy OSM map tiles for phone."""
    url = f"https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    resp = await http_client.get(url, headers={"User-Agent": "DroneControl/1.0"})
    return Response(content=resp.content, media_type="image/png")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    import asyncio

    connected = await manager.connect(websocket)
    if not connected:
        return

    queue: asyncio.Queue = asyncio.Queue(maxsize=2)

    async def reader():
        """Read messages as fast as possible so the WS stays healthy."""
        try:
            while True:
                data = await websocket.receive_text()
                # Drop old frames if consumer is slow — keep only latest
                if queue.full():
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                await queue.put(data)
        except WebSocketDisconnect:
            await queue.put(None)
        except Exception:
            await queue.put(None)

    async def processor():
        """Process messages from queue — heavy work happens here."""
        while True:
            data = await queue.get()
            if data is None:
                break
            await manager.handle_message(data)

    reader_task = asyncio.create_task(reader())
    try:
        await processor()
    finally:
        reader_task.cancel()
        await manager.disconnect()


@app.websocket("/ws/dashboard")
async def dashboard_ws(websocket: WebSocket):
    """WebSocket for dashboard viewers — receives live frames + detections."""
    await manager.dashboard_connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.handle_dashboard_message(data)
    except WebSocketDisconnect:
        await manager.dashboard_disconnect(websocket)
    except Exception:
        await manager.dashboard_disconnect(websocket)


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard():
    """Live dashboard showing phone stream, detections, and mission state."""
    return DASHBOARD_HTML


DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Drone Control Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', system-ui, sans-serif; }
  .header { background: #111; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #222; }
  .header h1 { font-size: 18px; font-weight: 600; color: #fff; }
  .connection-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 8px; }
  .dot-green { background: #2ecc71; box-shadow: 0 0 6px #2ecc71; }
  .dot-red { background: #e74c3c; box-shadow: 0 0 6px #e74c3c; }
  .dot-yellow { background: #f39c12; box-shadow: 0 0 6px #f39c12; }
  .main { display: flex; height: calc(100vh - 49px); }
  .video-panel { flex: 1; position: relative; background: #000; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .video-panel canvas { max-width: 100%; max-height: 100%; }
  .no-signal { color: #555; font-size: 24px; position: absolute; }
  .sidebar { width: 320px; background: #111; border-left: 1px solid #222; overflow-y: auto; flex-shrink: 0; }
  .panel { padding: 16px; border-bottom: 1px solid #222; }
  .panel-title { font-size: 12px; text-transform: uppercase; color: #666; letter-spacing: 1px; margin-bottom: 10px; }
  .stat-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
  .stat-label { color: #888; }
  .stat-value { color: #fff; font-weight: 500; font-variant-numeric: tabular-nums; }
  .state-badge { display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; text-transform: uppercase; }
  .state-input { background: #333; color: #aaa; }
  .state-navigation { background: #1a3a5c; color: #5dade2; }
  .state-identification { background: #4a3520; color: #f0a040; }
  .state-approach { background: #1a4a2a; color: #58d68d; }
  .state-delivery { background: #4a1a4a; color: #c39bd3; }
  .state-hover { background: #4a1a1a; color: #e74c3c; }
  .state-done { background: #2a4a2a; color: #2ecc71; }
  .det-list { max-height: 200px; overflow-y: auto; }
  .det-item { padding: 6px 8px; margin: 4px 0; border-radius: 6px; font-size: 13px; }
  .det-matched { background: #1a4a2a; border: 1px solid #2ecc71; }
  .det-unmatched { background: #1a1a2a; border: 1px solid #333; }
  .controls { padding: 16px; }
  .controls button { background: #222; color: #ccc; border: 1px solid #333; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-right: 8px; }
  .controls button:hover { background: #333; }
  .toggle-btn { width: 100%; padding: 10px 16px; border-radius: 6px; border: 1px solid #333; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.15s; }
  .toggle-off { background: #1a1a2a; color: #888; }
  .toggle-on { background: #1a3a1a; color: #2ecc71; border-color: #2ecc71; }
  .log-area { font-family: monospace; font-size: 12px; color: #888; max-height: 180px; overflow-y: auto; padding: 8px; background: #0a0a0a; border-radius: 6px; }
  .log-area div { padding: 1px 0; }
  .log-area .log-frame { color: #555; }
  .log-area .log-det { color: #f0a040; }
  .log-area .log-state { color: #5dade2; }
</style>
</head>
<body>
<div class="header">
  <h1>Drone Control Dashboard</h1>
  <div>
    <span class="connection-dot dot-red" id="connDot"></span>
    <span id="connText" style="font-size:13px;color:#888">Connecting...</span>
  </div>
</div>
<div class="main">
  <div class="video-panel">
    <canvas id="canvas" width="1280" height="720"></canvas>
    <div class="no-signal" id="noSignal">NO SIGNAL</div>
  </div>
  <div class="sidebar">
    <div class="panel">
      <div class="panel-title">Mission State</div>
      <div style="margin-bottom:8px"><span class="state-badge state-input" id="stateBadge">INPUT</span></div>
      <div class="stat-row"><span class="stat-label">Target</span><span class="stat-value" id="targetAddr">—</span></div>
      <div class="stat-row"><span class="stat-label">Waypoint</span><span class="stat-value" id="waypoint">—</span></div>
    </div>
    <div class="panel">
      <div class="panel-title">Detection</div>
      <button class="toggle-btn toggle-off" id="detectBtn" onclick="toggleDetect()">Detect: OFF</button>
      <div style="color:#555;font-size:11px;margin-top:6px">Runs every 10th frame (~1 detect/sec)</div>
      <div class="stat-row" style="margin-top:8px"><span class="stat-label">Reference Photo</span><span class="stat-value" id="refStatus" style="color:#e74c3c">None</span></div>
    </div>
    <div class="panel">
      <div class="panel-title">Stream</div>
      <div class="stat-row"><span class="stat-label">FPS</span><span class="stat-value" id="fps">0</span></div>
      <div class="stat-row"><span class="stat-label">Frames</span><span class="stat-value" id="frameCount">0</span></div>
      <div class="stat-row"><span class="stat-label">Resolution</span><span class="stat-value" id="resolution">—</span></div>
    </div>
    <div class="panel">
      <div class="panel-title">GPS</div>
      <div class="stat-row"><span class="stat-label">Lat</span><span class="stat-value" id="gpsLat">—</span></div>
      <div class="stat-row"><span class="stat-label">Lng</span><span class="stat-value" id="gpsLng">—</span></div>
      <div class="stat-row"><span class="stat-label">Alt</span><span class="stat-value" id="gpsAlt">—</span></div>
    </div>
    <div class="panel">
      <div class="panel-title">Detections</div>
      <div class="det-list" id="detList"><span style="color:#555;font-size:13px">No detections</span></div>
    </div>
    <div class="panel">
      <div class="panel-title">Log</div>
      <div class="log-area" id="logArea"></div>
    </div>
  </div>
</div>
<script>
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const noSignal = document.getElementById('noSignal');
const img = new Image();
let ws = null;
let lastFrameTime = 0;
let pendingBlob = null;
let latestMeta = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws/dashboard');
  ws.binaryType = 'blob';

  ws.onopen = () => {
    document.getElementById('connDot').className = 'connection-dot dot-green';
    document.getElementById('connText').textContent = 'Connected';
    addLog('Connected to server', 'log-state');
  };

  ws.onclose = () => {
    document.getElementById('connDot').className = 'connection-dot dot-red';
    document.getElementById('connText').textContent = 'Disconnected';
    addLog('Disconnected — reconnecting...', 'log-state');
    setTimeout(connect, 2000);
  };

  ws.onerror = () => { ws.close(); };

  ws.onmessage = (e) => {
    if (e.data instanceof Blob) {
      // Binary = raw JPEG frame
      if (pendingBlob) URL.revokeObjectURL(pendingBlob);
      pendingBlob = URL.createObjectURL(e.data);
      drawFrame();
    } else {
      // Text = JSON metadata
      try {
        latestMeta = JSON.parse(e.data);
        updateMeta(latestMeta);
      } catch(err) {}
    }
  };
}

function drawFrame() {
  if (!pendingBlob) return;
  noSignal.style.display = 'none';
  lastFrameTime = Date.now();

  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    document.getElementById('resolution').textContent = img.width + 'x' + img.height;

    // Draw detections from latest metadata
    if (latestMeta && latestMeta.detections && latestMeta.detections.length > 0) {
      latestMeta.detections.forEach(det => {
        const [x1, y1, x2, y2] = det.bbox;
        ctx.lineWidth = 3;
        if (det.matched) {
          ctx.strokeStyle = '#2ecc71';
          ctx.shadowColor = '#2ecc71';
        } else {
          ctx.strokeStyle = '#e74c3c';
          ctx.shadowColor = '#e74c3c';
        }
        ctx.shadowBlur = 8;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.shadowBlur = 0;

        const label = det.matched
          ? 'MATCH ' + Math.round(det.confidence) + '%'
          : 'Person ' + Math.round(det.confidence) + '%';
        ctx.font = 'bold 14px monospace';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = det.matched ? 'rgba(46,204,113,0.85)' : 'rgba(231,76,60,0.85)';
        ctx.fillRect(x1, y1 - 20, tw + 8, 20);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, x1 + 4, y1 - 5);
      });
    }
  };
  img.src = pendingBlob;
}

function updateMeta(msg) {
  document.getElementById('fps').textContent = msg.fps;
  document.getElementById('frameCount').textContent = msg.frame_count;

  const badge = document.getElementById('stateBadge');
  badge.textContent = msg.state.toUpperCase();
  badge.className = 'state-badge state-' + msg.state;

  const gps = msg.gps;
  document.getElementById('gpsLat').textContent = gps.lat ? gps.lat.toFixed(6) : '—';
  document.getElementById('gpsLng').textContent = gps.lng ? gps.lng.toFixed(6) : '—';
  document.getElementById('gpsAlt').textContent = gps.alt ? gps.alt.toFixed(1) + 'm' : '—';

  document.getElementById('waypoint').textContent = msg.waypoint;
  document.getElementById('targetAddr').textContent = msg.target_address || '—';
  updateDetectBtn(msg.detect_enabled);
  const refEl = document.getElementById('refStatus');
  if (msg.has_reference) { refEl.textContent = 'Uploaded'; refEl.style.color = '#2ecc71'; }
  else { refEl.textContent = 'None'; refEl.style.color = '#e74c3c'; }

  const detList = document.getElementById('detList');
  if (msg.detections && msg.detections.length > 0) {
    detList.innerHTML = msg.detections.map(d => {
      const cls = d.matched ? 'det-matched' : 'det-unmatched';
      const icon = d.matched ? '&#10003;' : '&#10007;';
      return '<div class="det-item ' + cls + '">' + icon + ' Person — '
        + Math.round(d.confidence) + '% confidence</div>';
    }).join('');
  } else {
    detList.innerHTML = '<span style="color:#555;font-size:13px">No detections</span>';
  }
}

function addLog(text, cls) {
  const area = document.getElementById('logArea');
  const div = document.createElement('div');
  div.className = cls || '';
  const ts = new Date().toLocaleTimeString();
  div.textContent = ts + ' ' + text;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  // Keep last 100 entries
  while (area.children.length > 100) area.removeChild(area.firstChild);
}

// No-signal timeout
setInterval(() => {
  if (lastFrameTime && Date.now() - lastFrameTime > 5000) {
    noSignal.style.display = 'block';
    document.getElementById('connDot').className = 'connection-dot dot-yellow';
    document.getElementById('connText').textContent = 'No frames';
  }
}, 1000);

function toggleDetect() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'toggle_detect' }));
  }
}

function updateDetectBtn(enabled) {
  const btn = document.getElementById('detectBtn');
  if (enabled) {
    btn.textContent = 'Detect: ON';
    btn.className = 'toggle-btn toggle-on';
  } else {
    btn.textContent = 'Detect: OFF';
    btn.className = 'toggle-btn toggle-off';
  }
}

connect();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    uvicorn.run("main:app", host=WS_HOST, port=WS_PORT, reload=False)
