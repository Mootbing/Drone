# Drone Delivery & Identification System

Autonomous drone delivery system that navigates street-level routes, identifies a target person using computer vision, and delivers a message. A phone captures the drone manufacturer's app screen and streams frames to a PC server over USB for processing. The server runs SAM segmentation and Amazon Rekognition face matching, then sends movement commands back to the phone, which injects touch gestures into the drone app via Android's Accessibility Service.

All network traffic between the phone and server runs over USB via `adb reverse` port forwarding — the phone's WiFi stays connected to the drone.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         PHONE (Android)                              │
│                                                                      │
│  ┌──────────────┐    ┌──────────────────┐    ┌───────────────────┐   │
│  │ React Native │    │ MediaProjection  │    │  Accessibility    │   │
│  │   App UI     │───▶│ Screen Capture   │    │  Service (Touch)  │   │
│  │              │    │ (10fps, 2400x1080)│    │  Gesture Inject   │   │
│  └──────┬───────┘    └────────┬─────────┘    └───────▲───────────┘   │
│         │                     │                      │               │
│         │              base64 JPEG frames      swipe gestures        │
│         │                     │                      │               │
│         └─────────┬───────────┘                      │               │
│                   │ WebSocket (JSON) via USB          │               │
│                   ▼                                   │               │
└───────────────────┼───────────────────────────────────┼───────────────┘
                    │  USB (adb reverse)                │
                    │  ws://localhost:8765/ws            │
                    │                                   │
┌───────────────────┼───────────────────────────────────┼───────────────┐
│                   ▼            PC SERVER              │               │
│  ┌──────────────────────────────────────────────────┐ │               │
│  │              FastAPI + WebSocket                  │ │               │
│  │                                                  │ │               │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────┐ │ │               │
│  │  │   State     │  │  SAM ViT-B   │  │ Amazon  │ │ │               │
│  │  │  Machine    │  │  Segment     │  │ Rekog-  │ │ │               │
│  │  │             │  │  Anything    │  │ nition  │ │ │               │
│  │  └─────────────┘  └──────────────┘  └─────────┘ │ │               │
│  │                                                  │ │               │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────┐ │ │               │
│  │  │  HTTP Proxy │  │  Person      │  │ Approach│ │ │               │
│  │  │ (Geocode,   │  │  Detector    │  │ Control │ │ │               │
│  │  │  Route,Tile)│  │  (Heuristic) │  │         │ │ │               │
│  │  └─────────────┘  └──────────────┘  └─────────┘ │ │               │
│  │                                                  │ │               │
│  │            movement commands (JSON) ─────────────┼─┘               │
│  └──────────────────────────────────────────────────┘                 │
└───────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Phone WiFi** → Drone (flight control)
2. **Phone USB** → PC Server (frames, commands, geocoding, maps)
3. `adb reverse tcp:8765 tcp:8765` tunnels server to `localhost:8765` on phone
4. `adb reverse tcp:8081 tcp:8081` tunnels Metro bundler for dev

---

## How It Works

### 1. Mission Input

The user opens the phone app and enters:
- **Delivery address** — search via autocomplete (Nominatim)
- **Reference photo** of the target person (from camera or gallery)
- **Delivery message** (default: "moo")

The address is geocoded via **Nominatim** (free, no API key) through the server proxy. A street-level route is computed via **OSRM** and displayed on a **Leaflet/OpenStreetMap** map rendered in a WebView. The map shows the user's GPS location, the destination, and the driving route.

### 2. Navigation

The drone follows the planned waypoints sequentially at altitude, staying above streets. For each frame received from the phone (~10 fps):

1. **GPS comparison**: The server compares the drone's current GPS to the next waypoint using haversine distance
2. **Heading computation**: Bearing from current position to target waypoint is computed, then compared to the drone's heading
3. **Command generation**: If the target is >30° off-axis, a rotation command is issued; otherwise a forward command with distance-scaled intensity

**Waypoint advancement**: When the drone comes within `WAYPOINT_REACHED_RADIUS_M` (default 10m) of a waypoint, it advances to the next one. When within `IDENTIFICATION_RANGE_M` (default 50m) of the final destination, the system switches to identification mode.

**Obstacle detection** is currently disabled by default (`OBSTACLE_DETECTION_ENABLED=false`). The obstacle detection interface is pluggable — see [Obstacle Detection](#obstacle-detection) below.

### 3. Identification

Once near the destination, the server uses **SAM (Segment Anything Model)** to segment each frame into regions, then filters for person-shaped segments using heuristics:

| Heuristic | Threshold | Purpose |
|-----------|-----------|---------|
| Aspect ratio (h/w) | 1.2 – 5.0 | People are taller than wide |
| Area fraction | 1% – 60% of frame | Filter tiny noise and full-frame masks |
| Min height | 10% of frame height | Person must be visible enough |
| Max width | 50% of frame width | Reject overly wide segments |
| Color variation | HSV hue std > 15 | People have varied colors (skin, clothing) |

Each person candidate is cropped and sent to **Amazon Rekognition CompareFaces** to match against the reference photo. If similarity exceeds `REKOGNITION_SIMILARITY_THRESHOLD` (default 90%), the system transitions to approach mode.

### 4. Approach

The server tracks the matched person's bounding box across frames and computes movement commands to fly toward them:

- **Centered in frame**: Move forward (intensity 0.4)
- **Off-center horizontally**: Move left/right toward person
- **Off-center vertically**: Move up/down toward person
- **Person fills >15% of frame**: Arrival — switch to delivery mode

A dead zone of 15% around frame center prevents jittery corrections.

### 5. Delivery

The drone hovers in place. The phone displays the delivery message fullscreen. When the user (or target person) taps "Confirm Delivery", the mission completes.

---

## State Machine

```
INPUT ──▶ NAVIGATION ──▶ IDENTIFICATION ──▶ APPROACH ──▶ DELIVERY ──▶ DONE
  │            │                │                │                       │
  │            │                │                │                       │
  │            └────────────────┴────────────────┘                       │
  │                        abort → HOVER                                 │
  │                           │                                          │
  └───────────────────────────┴──────────────────────────────────────────┘
                          (restart)
```

| State | Description | Frame Processing |
|-------|-------------|-----------------|
| `INPUT` | Waiting for mission parameters | None |
| `NAVIGATION` | Following GPS waypoints | Route following (+ optional obstacle avoidance) |
| `IDENTIFICATION` | Scanning for target person | SAM segmentation → person filtering → Rekognition |
| `APPROACH` | Flying toward matched person | Bounding box tracking → directional commands |
| `DELIVERY` | Hovering, showing message | None (hover) |
| `DONE` | Mission complete | None |
| `HOVER` | Emergency stop (abort) | None (hover) |

---

## Phone App (React Native + Android Native)

### Screens

| Screen | Purpose |
|--------|---------|
| `InputScreen` | Server connection, address search, reference photo, delivery message, test mode |
| `WatchScreen` | Streaming screen — starts capture, black screen with "Streaming live via USB" status |
| `DeliveryScreen` | Displays delivery message, confirm button |

### Features

- **Auto-connect** to WebSocket server on launch (`ws://localhost:8765/ws`)
- **Server URL modal** — reconfigure connection via button
- **Address autocomplete** — debounced Nominatim search through server proxy
- **Route map** — Leaflet + OSM tiles rendered in WebView, shows driving route from user to destination
- **Test mode** — "Test" button skips validation and goes straight to the Watch screen
- **Live dashboard** — browser UI at `http://localhost:8765/dashboard` shows live stream, detections, GPS, mission state
- **Dark UI** — black background (#000), white buttons, dark inputs

### Native Modules (Kotlin)

**Screen Capture** (`ScreenCaptureModule` + `ScreenCaptureService`):
- Uses Android **MediaProjection API** to capture the drone manufacturer's app screen
- Runs as a foreground service with `mediaProjection` foreground service type
- Captures at 2400x1080 (native resolution), JPEG quality 85, ~10 fps
- Emits `onFrameCaptured` events with base64 JPEG data

**Touch Injection** (`DroneAccessibilityService` + `TouchInjectorModule`):
- Uses Android **Accessibility Service** with `GestureDescription` API
- Maps directional commands to swipe gestures on configurable joystick positions
- Right joystick: forward/back/left/right (pitch & roll)
- Left joystick: up/down (throttle), rotate_cw/rotate_ccw (yaw)
- Intensity (0.0–1.0) scales swipe distance from joystick center

### Server Proxy Endpoints

Since the phone's WiFi is connected to the drone, all HTTP requests go through the server via USB:

| Endpoint | Purpose |
|----------|---------|
| `GET /geocode?q=...` | Nominatim address search |
| `GET /reverse-geocode?lat=...&lon=...` | Nominatim reverse geocoding |
| `GET /route?from_lat=...&from_lng=...&to_lat=...&to_lng=...` | OSRM driving route |
| `GET /tile/{z}/{x}/{y}.png` | OpenStreetMap tile proxy |
| `GET /health` | Server health check |
| `GET /dashboard` | Live web dashboard (stream, detections, GPS, state) |
| `WS /ws/dashboard` | Dashboard WebSocket (binary JPEG frames + JSON metadata) |

---

## Communication Protocol

All communication is over a single WebSocket connection (`ws://localhost:8765/ws`). Messages are JSON.

### Phone → PC

**Frame** (~10 fps):
```json
{
  "type": "frame",
  "timestamp": 1700000000000,
  "gps": { "lat": 40.7128, "lng": -74.0060, "alt": 30.0 },
  "frame": "<base64 JPEG, 2400x1080>"
}
```

**Mission Input**:
```json
{
  "type": "mission_input",
  "address": "123 Main St, New York, NY",
  "reference_photo": "<base64 JPEG>",
  "delivery_message": "moo",
  "gps": { "lat": 40.71, "lng": -74.00, "alt": 0 }
}
```

**Other**: `ping`, `abort`, `delivery_confirmed`, `status`

### PC → Phone

**Movement Command**:
```json
{
  "type": "command",
  "action": "move",
  "direction": "forward",
  "intensity": 0.7,
  "duration_ms": 500
}
```

Directions: `forward`, `back`, `left`, `right`, `up`, `down`, `rotate_cw`, `rotate_ccw`, `none`

**Mode Change**:
```json
{
  "type": "mode_change",
  "mode": "identification",
  "message": "Arrived at target zone, scanning for people..."
}
```

**Identification Result**:
```json
{
  "type": "identified",
  "match": true,
  "confidence": 96.2,
  "person_bbox": [120, 80, 340, 400],
  "action": "approach"
}
```

**Other**: `pong`, `error`

---

## Obstacle Detection

Obstacle detection is **disabled by default**. The drone flies its route without visual obstacle analysis.

### Enabling Obstacle Detection

1. Set `OBSTACLE_DETECTION_ENABLED=true` in `.env`
2. Register a detection backend:

```python
from navigation.obstacle_avoidance import register_backend

def my_depth_detector(frame, masks):
    """Analyze frame for obstacles using depth estimation."""
    return {
        "direction": "left",
        "intensity": 0.7,
        "duration_ms": 600,
        "reroute": True,
    }

register_backend("depth", my_depth_detector)
```

### Backend Interface

```python
def detector(frame: np.ndarray, masks: List[Dict]) -> Optional[Dict]
```

- `frame`: BGR image array (H, W, 3)
- `masks`: SAM segmentation masks (list of dicts with `segmentation`, `area`, `bbox`)
- Returns: `None` if clear, or `{"direction": str, "intensity": float, "duration_ms": int}` to avoid

---

## Project Structure

```
Drone/
├── server/                              # PC backend (Python/FastAPI)
│   ├── main.py                          # FastAPI app, WebSocket, HTTP proxy endpoints
│   ├── config.py                        # Environment config (.env), constants
│   ├── ws_handler.py                    # WebSocket connection manager, message routing
│   ├── state_machine.py                 # Mission state machine (7 states)
│   ├── navigation/
│   │   ├── geocoder.py                  # Google Maps Geocoding API
│   │   ├── router.py                    # Google Maps Directions API, polyline decoding
│   │   ├── commander.py                 # GPS → heading → movement commands
│   │   ├── obstacle_avoidance.py        # Pluggable obstacle detection (disabled by default)
│   │   └── geo_utils.py                 # Shared haversine distance function
│   ├── identification/
│   │   ├── person_detector.py           # SAM mask filtering for person shapes
│   │   ├── face_matcher.py              # Amazon Rekognition CompareFaces
│   │   └── approach.py                  # Bounding box → approach commands
│   ├── models/
│   │   └── sam_loader.py                # SAM model loading & inference wrapper
│   └── tests/                           # 95 unit tests (pytest)
│       ├── test_state_machine.py
│       ├── test_ws_handler.py
│       ├── test_commander.py
│       ├── test_approach.py
│       ├── test_obstacle_avoidance.py
│       ├── test_person_detector.py
│       ├── test_geo_utils.py
│       └── test_health.py
│
├── phone/                               # Android app (React Native + Kotlin)
│   ├── App.tsx                          # Navigation root (3 screens)
│   ├── index.js                         # React Native entry point
│   ├── metro.config.js                  # Metro bundler config
│   ├── src/
│   │   ├── screens/
│   │   │   ├── InputScreen.tsx          # Mission setup UI + map + address search
│   │   │   ├── WatchScreen.tsx          # Streaming screen (capture + USB stream)
│   │   │   └── DeliveryScreen.tsx       # Delivery confirmation
│   │   ├── services/
│   │   │   ├── WebSocketService.ts      # WebSocket client (singleton, reconnect, heartbeat)
│   │   │   ├── ScreenCapture.ts         # Bridge to native MediaProjection
│   │   │   └── DroneControl.ts          # Bridge to native Accessibility Service
│   │   ├── components/
│   │   │   ├── NavigationOverlay.tsx     # Direction arrows + mode badge
│   │   │   ├── StatusBar.tsx            # Connection status
│   │   │   └── ManualControl.tsx        # Manual flight pads (fallback)
│   │   └── types/
│   │       └── protocol.ts             # Shared message type definitions
│   └── android/app/src/main/java/com/dronecontrol/
│       ├── screencapture/
│       │   ├── ScreenCaptureModule.kt   # RN bridge for MediaProjection
│       │   ├── ScreenCaptureService.kt  # Foreground service, frame capture
│       │   └── ScreenCapturePackage.kt  # RN package registration
│       └── accessibility/
│           ├── DroneAccessibilityService.kt  # Gesture injection via Accessibility API
│           ├── TouchInjectorModule.kt        # RN bridge for touch injection
│           └── TouchInjectorPackage.kt       # RN package registration
│
└── README.md
```

---

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- Android device with USB debugging enabled
- NVIDIA GPU recommended for SAM inference (CPU works but slower)
- WSL2 or Linux (Windows adb.exe used for USB device communication)

### Cloud Services

| Service | Purpose | Required? |
|---------|---------|-----------|
| **AWS Rekognition** | Face comparison (CompareFaces) | Yes (for identification) |
| **SAM Model** (local) | Image segmentation | Yes (auto-downloaded) |
| **Nominatim** | Address geocoding | Free, no key needed |
| **OSRM** | Street routing | Free, no key needed |
| **OpenStreetMap** | Map tiles | Free, no key needed |

### Server Setup

```bash
cd server

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Download SAM checkpoint (~358MB)
mkdir -p models
wget -O models/sam_vit_b_01ec64.pth \
  https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth

# Configure environment
cp .env.example .env
# Fill in: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY

# Start server
python main.py
# Server runs at ws://0.0.0.0:8765/ws
```

### Phone Setup

```bash
cd phone

# Install dependencies
npm install

# Build and install on device
cd android && ./gradlew app:assembleDebug && cd ..

# Install APK (use Windows adb if in WSL2)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# Set up USB port forwarding
adb reverse tcp:8765 tcp:8765  # Server
adb reverse tcp:8081 tcp:8081  # Metro dev server

# Start Metro bundler
npx react-native start --host 0.0.0.0
```

After installing, enable the Accessibility Service:
1. Open Android Settings → Accessibility
2. Find "Drone Control" and enable it
3. Grant screen capture permission when prompted

### Environment Variables

```env
# Server
WS_HOST=0.0.0.0
WS_PORT=8765

# AWS Rekognition
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key_here
AWS_SECRET_ACCESS_KEY=your_secret_here
REKOGNITION_SIMILARITY_THRESHOLD=90.0

# SAM Model
SAM_MODEL_TYPE=vit_b
SAM_CHECKPOINT_PATH=models/sam_vit_b_01ec64.pth
SAM_DEVICE=cuda          # or "cpu"

# Navigation
WAYPOINT_REACHED_RADIUS_M=10.0
IDENTIFICATION_RANGE_M=50.0

# Obstacle Detection (disabled by default)
OBSTACLE_DETECTION_ENABLED=false
```

---

## Testing

```bash
cd server
source venv/bin/activate
python -m pytest tests/ -v
```

95 tests covering:
- State machine transitions and guards (18 tests)
- WebSocket connection management and message routing (22 tests)
- Navigation command generation and bearing computation (8 tests)
- Approach command computation and edge cases (11 tests)
- Obstacle detection pluggable backend system (12 tests)
- Person detection heuristics (7 tests)
- Haversine distance calculations (6 tests)
- Health endpoint integration (1 test)

---

## Key Constants

| Constant | Default | Location | Description |
|----------|---------|----------|-------------|
| `WAYPOINT_REACHED_RADIUS_M` | 10.0m | config.py | Distance to consider a waypoint reached |
| `IDENTIFICATION_RANGE_M` | 50.0m | config.py | Switch to identification when this close to target |
| `REKOGNITION_SIMILARITY_THRESHOLD` | 90.0% | config.py | Minimum face match confidence |
| `ARRIVAL_AREA_THRESHOLD` | 0.15 | approach.py | Person fills 15% of frame = arrived |
| `CENTER_DEAD_ZONE` | 0.15 | approach.py | No correction needed in center 15% |
| `MIN_ASPECT_RATIO` | 1.2 | person_detector.py | Minimum height/width for person shape |
| `MAX_ASPECT_RATIO` | 5.0 | person_detector.py | Maximum height/width for person shape |
| `OBSTACLE_CENTER_THRESHOLD` | 0.3 | config.py | Fraction of frame center considered "in path" |
| `OBSTACLE_MIN_AREA_FRACTION` | 0.05 | config.py | Minimum segment area to count as obstacle |
