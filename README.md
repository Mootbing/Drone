# Drone Delivery & Identification System

Autonomous drone delivery system that navigates street-level routes, identifies a target person using computer vision, and delivers a message. A phone captures the drone manufacturer's app screen and streams frames to a PC server over USB for processing. The server runs SAM segmentation and face matching, then sends movement commands back to the phone, which injects touch gestures into the drone app via Android's Accessibility Service.

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
│  │  │   State     │  │  SAM ViT-B   │  │  Face   │ │ │               │
│  │  │  Machine    │  │  Segment     │  │ Matcher │ │ │               │
│  │  │             │  │  Anything    │  │         │ │ │               │
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

## Phone App (React Native + Android Native)

### Screens

| Screen | Purpose |
|--------|---------|
| `InputScreen` | Uber-style booking: From (GPS) / To (address search), route map with waypoints, turn-by-turn directions, reference photo, delivery message |
| `SettingsScreen` | Server WebSocket URL config, connection status, reference photo (persisted via AsyncStorage) |
| `WatchScreen` | Streaming screen — starts capture, black screen with "Streaming live via USB" status |
| `DeliveryScreen` | Displays delivery message, confirm button |

### Features

- **Uber-style booking UI** — From/To card with green/red dots, reverse-geocoded current location
- **Address autocomplete** — debounced Nominatim search through server proxy
- **Route map** — Leaflet + OSM tiles rendered in WebView, waypoint markers at each turn
- **Turn-by-turn waypoints** — scrollable list with coordinates, tappable to highlight on map
- **Reference photo** — pick from gallery or camera, persisted across restarts via AsyncStorage
- **GPS retry** — 3 attempts with high/low accuracy fallback
- **Live dashboard** — browser UI at `http://localhost:8765/dashboard` with live stream, detections, GPS, mission state
- **Settings page** — server URL config, connection management (top-right button)
- **Test mode** — "Test" button starts streaming without mission validation

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
| `GET /route?from_lat=...&from_lng=...&to_lat=...&to_lng=...` | OSRM driving route (with steps) |
| `GET /tile/{z}/{x}/{y}.png` | OpenStreetMap tile proxy |
| `GET /health` | Server health check |
| `GET /dashboard` | Live web dashboard (stream, detections, GPS, state) |
| `WS /ws/dashboard` | Dashboard WebSocket (binary JPEG frames + JSON metadata) |

---

## How It Works

### 1. Mission Input

The user opens the phone app and sees an Uber-style booking screen:
- **From** — current GPS location, automatically reverse-geocoded to a street address
- **To** — search via Nominatim autocomplete, select destination
- Route map appears with waypoint markers at each turn
- Scrollable turn-by-turn directions with coordinates (tappable to highlight on map)
- **Reference photo** of the target person (from camera or gallery, persisted)
- **Delivery message** (default: "moo")

On "Book Delivery", the phone sends all turn-by-turn waypoint coordinates to the server.

### 2. Navigation

The drone follows the planned waypoints (turn-by-turn coordinates from OSRM) sequentially. For each frame received from the phone (~10 fps):

1. **GPS comparison**: The server compares the drone's current GPS to the next waypoint using haversine distance
2. **Heading computation**: Bearing from current position to target waypoint
3. **Command generation**: If the target is >30° off-axis, a rotation command is issued; otherwise a forward command with distance-scaled intensity

**Waypoint advancement**: When the drone comes within `WAYPOINT_REACHED_RADIUS_M` (default 10m) of a waypoint, it advances to the next one. When within `IDENTIFICATION_RANGE_M` (default 50m) of the final destination, the system switches to identification mode.

### 3. Identification

Once near the destination, the server uses **SAM (Segment Anything Model)** to segment each frame into regions, then filters for person-shaped segments using heuristics. Each person candidate is matched against the reference photo. If similarity exceeds the threshold, the system transitions to approach mode.

### 4. Approach

The server tracks the matched person's bounding box across frames and computes movement commands to center and approach them. When the person fills >15% of the frame, it's considered arrived.

### 5. Delivery

The drone hovers in place. The phone displays the delivery message fullscreen. When "Confirm Delivery" is tapped, the mission completes.

---

## State Machine

```
INPUT ──▶ NAVIGATION ──▶ IDENTIFICATION ──▶ APPROACH ──▶ DELIVERY ──▶ DONE
  │            │                │                │                       │
  │            └────────────────┴────────────────┘                       │
  │                        abort → HOVER                                 │
  └─────────────────────────────┴────────────────────────────────────────┘
```

| State | Description | Frame Processing |
|-------|-------------|-----------------|
| `INPUT` | Waiting for mission parameters | None |
| `NAVIGATION` | Following GPS waypoints | Route following (+ optional obstacle avoidance) |
| `IDENTIFICATION` | Scanning for target person | SAM segmentation → person filtering → face matching |
| `APPROACH` | Flying toward matched person | Bounding box tracking → directional commands |
| `DELIVERY` | Hovering, showing message | None (hover) |
| `DONE` | Mission complete | None |
| `HOVER` | Emergency stop (abort) | None (hover) |

---

## AI Inference Layer

See **[IMPLEMENTATION.md](IMPLEMENTATION.md)** for a complete guide on plugging in custom AI models (person detection, face matching, obstacle detection, segmentation).

---

## Project Structure

```
Drone/
├── server/                              # PC backend (Python/FastAPI)
│   ├── main.py                          # FastAPI app, WebSocket, HTTP proxy, dashboard
│   ├── config.py                        # Environment config (.env), constants
│   ├── ws_handler.py                    # WebSocket connection manager, frame pipeline
│   ├── state_machine.py                 # Mission state machine (7 states)
│   ├── navigation/
│   │   ├── geocoder.py                  # Nominatim geocoding
│   │   ├── router.py                    # OSRM routing, polyline decoding
│   │   ├── commander.py                 # GPS → heading → movement commands
│   │   ├── obstacle_avoidance.py        # Pluggable obstacle detection
│   │   └── geo_utils.py                 # Haversine distance
│   ├── identification/
│   │   ├── person_detector.py           # SAM mask filtering for person shapes
│   │   ├── face_matcher.py              # AWS Rekognition CompareFaces
│   │   └── approach.py                  # Bounding box → approach commands
│   ├── models/
│   │   └── sam_loader.py                # SAM model loading & inference wrapper
│   └── tests/                           # 95 unit tests (pytest)
│
├── phone/                               # Android app (React Native + Kotlin)
│   ├── App.tsx                          # Navigation root (4 screens)
│   ├── src/
│   │   ├── screens/
│   │   │   ├── InputScreen.tsx          # Uber-style booking with waypoints
│   │   │   ├── SettingsScreen.tsx       # Server config + reference photo
│   │   │   ├── WatchScreen.tsx          # Streaming screen
│   │   │   └── DeliveryScreen.tsx       # Delivery confirmation
│   │   ├── services/
│   │   │   ├── WebSocketService.ts      # WebSocket client (reconnect, heartbeat)
│   │   │   ├── ScreenCapture.ts         # Bridge to native MediaProjection
│   │   │   └── DroneControl.ts          # Bridge to native Accessibility Service
│   │   └── types/
│   │       └── protocol.ts             # Shared message type definitions
│   └── android/app/src/main/java/com/dronecontrol/
│       ├── screencapture/               # MediaProjection screen capture
│       └── accessibility/               # Gesture injection via Accessibility API
│
├── README.md
└── IMPLEMENTATION.md                    # AI inference integration guide
```

---

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- Android device with USB debugging enabled
- NVIDIA GPU recommended for SAM inference (CPU works but slower)
- WSL2 or Linux (Windows adb.exe used for USB device communication)

### Server Setup

```bash
cd server
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Download SAM checkpoint (~358MB)
mkdir -p models
wget -O models/sam_vit_b_01ec64.pth \
  https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth

# Configure environment
cp .env.example .env
# Fill in: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (optional — see IMPLEMENTATION.md)

python main.py
```

### Phone Setup

```bash
cd phone
npm install
cd android && ./gradlew app:assembleDebug && cd ..

# Install APK (use Windows adb if in WSL2)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# USB port forwarding
adb reverse tcp:8765 tcp:8765  # Server
adb reverse tcp:8081 tcp:8081  # Metro dev server

# Start Metro bundler
npx react-native start --host 0.0.0.0
```

Enable the Accessibility Service: Android Settings → Accessibility → Drone Control → Enable

### Environment Variables

```env
WS_HOST=0.0.0.0
WS_PORT=8765

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key_here
AWS_SECRET_ACCESS_KEY=your_secret_here
REKOGNITION_SIMILARITY_THRESHOLD=90.0

SAM_MODEL_TYPE=vit_b
SAM_CHECKPOINT_PATH=models/sam_vit_b_01ec64.pth
SAM_DEVICE=cuda

WAYPOINT_REACHED_RADIUS_M=10.0
IDENTIFICATION_RANGE_M=50.0
OBSTACLE_DETECTION_ENABLED=false
```

---

## Testing

```bash
cd server && source venv/bin/activate
python -m pytest tests/ -v
```

95 tests covering state machine, WebSocket handling, navigation, approach, obstacle detection, person detection, geo utils, and health endpoint.
