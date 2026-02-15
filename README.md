# SkyHeart — Drone Delivery & Identification System

Autonomous drone delivery system that navigates street-level routes, identifies a target person using computer vision, and delivers a message. A phone captures the drone manufacturer's app screen and streams frames to a PC server over USB for processing. The server runs YOLOv8 person detection and AWS Rekognition face matching, then sends movement commands back to the phone, which injects touch gestures into the drone app via Android's Accessibility Service.

All network traffic between the phone and server runs over USB via `adb reverse` port forwarding — the phone's WiFi stays connected to the drone.

---

## Architecture Overview

```
+----------------------------------------------------------------------+
|                         PHONE (Android)                              |
|                                                                      |
|  +---------------+    +------------------+    +-------------------+  |
|  | React Native  |    | MediaProjection  |    |  Accessibility    |  |
|  |   App UI      |--->| Screen Capture   |    |  Service (Touch)  |  |
|  | (SkyHeart)    |    | (10fps, 2400x1080)|    |  Gesture Inject   |  |
|  +-------+-------+    +--------+---------+    +-------^-----------+  |
|          |                     |                      |              |
|          |              base64 JPEG frames      swipe gestures       |
|          |                     |                      |              |
|          +----------+----------+                      |              |
|                     | WebSocket (JSON) via USB         |              |
|                     v                                  |              |
+---------------------+----------------------------------+--------------+
                      |  USB (adb reverse)               |
                      |  ws://localhost:8765/ws           |
                      |                                  |
+---------------------+----------------------------------+--------------+
|                     v            PC SERVER             |              |
|  +----------------------------------------------------+--+           |
|  |              FastAPI + WebSocket                       |           |
|  |                                                        |           |
|  |  +-----------+  +--------------+  +----------+         |           |
|  |  |   State   |  |  YOLOv8     |  |  Face    |         |           |
|  |  |  Machine  |  |  Nano       |  |  Matcher |         |           |
|  |  |           |  |  (~6MB)     |  | (Rekog.) |         |           |
|  |  +-----------+  +--------------+  +----------+         |           |
|  |                                                        |           |
|  |  +-----------+  +--------------+  +----------+         |           |
|  |  | HTTP Proxy|  |  Dashboard   |  | Approach |         |           |
|  |  | (Geocode, |  |  (detect     |  | Control  |         |           |
|  |  |  Route)   |  |   toggle)    |  |          |         |           |
|  |  +-----------+  +--------------+  +----------+         |           |
|  |                                                        |           |
|  |            movement commands (JSON) -------------------+           |
|  +----------------------------------------------------+              |
+----------------------------------------------------------------------+
```

### Data Flow

1. **Phone WiFi** -> Drone (flight control)
2. **Phone USB** -> PC Server (frames, commands, geocoding, maps)
3. `adb reverse tcp:8765 tcp:8765` tunnels server to `localhost:8765` on phone
4. `adb reverse tcp:8081 tcp:8081` tunnels Metro bundler for dev

---

## Phone App (React Native + Android Native)

### Screens

| Screen | Purpose |
|--------|---------|
| `InputScreen` | Uber-style booking: From (GPS) / To (address search), route map with waypoints, turn-by-turn directions, reference photo, delivery message |
| `SettingsScreen` | Server WebSocket URL, connection status, reference photo (persisted + auto-sent to server), drone app picker, accessibility service, action recorder, test streaming |
| `WatchScreen` | Streaming screen — starts capture, sends reference photo to server, black screen with "Streaming live via USB" status |
| `ActionRecorderScreen` | Fullscreen grid for recording tap positions (takeoff/landing) on the drone app |
| `DeliveryScreen` | Displays delivery message, confirm button |

### Features

- **Uber-style booking UI** — From/To card with green/red dots, reverse-geocoded current location
- **Address autocomplete** — debounced Nominatim search through server proxy
- **Route map** — Leaflet + OSM tiles rendered in WebView, waypoint markers at each turn
- **Turn-by-turn waypoints** — scrollable list with coordinates, tappable to highlight on map
- **Reference photo** — pick from gallery or camera, persisted across restarts, sent to server immediately on upload
- **Drone app picker** — select which drone manufacturer app to control
- **Action recorder** — record tap positions for takeoff/landing automation
- **GPS retry** — 3 attempts with high/low accuracy fallback
- **Live dashboard** — browser UI at `http://localhost:8765/dashboard` with live stream, detections, GPS, mission state
- **Test mode** — starts streaming without mission for detection testing

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
- Intensity (0.0-1.0) scales swipe distance from joystick center

**App Launcher** (`AppLauncher`):
- Lists installed apps, launches selected drone app by package name

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
| `WS /ws` | Phone WebSocket (frames, commands, mission data) |
| `WS /ws/dashboard` | Dashboard WebSocket (binary JPEG frames + JSON metadata, detect toggle) |

---

## How It Works

### 1. Mission Input

The user opens the phone app and sees an Uber-style booking screen:
- **From** — current GPS location, automatically reverse-geocoded to a street address
- **To** — search via Nominatim autocomplete, select destination
- Route map appears with waypoint markers at each turn
- Scrollable turn-by-turn directions with coordinates (tappable to highlight on map)
- **Reference photo** of the target person (from camera or gallery, persisted, sent to server on upload)
- **Delivery message** (default: "moo")

On "Book Delivery", the phone sends all turn-by-turn waypoint coordinates to the server.

### 2. Navigation

The drone follows the planned waypoints (turn-by-turn coordinates from OSRM) sequentially. For each frame received from the phone (~10 fps):

1. **GPS comparison**: The server compares the drone's current GPS to the next waypoint using haversine distance
2. **Heading computation**: Bearing from current position to target waypoint
3. **Command generation**: If the target is >30 degrees off-axis, a rotation command is issued; otherwise a forward command with distance-scaled intensity

**Waypoint advancement**: When the drone comes within `WAYPOINT_REACHED_RADIUS_M` (default 10m) of a waypoint, it advances to the next one. When within `IDENTIFICATION_RANGE_M` (default 50m) of the final destination, the system switches to identification mode.

### 3. Identification

Once near the destination, the server runs **YOLOv8 nano** on each frame to detect people (~20-50ms per frame on CPU). Each detected person's bounding box is cropped and sent to **AWS Rekognition** for face comparison against the reference photo. If similarity exceeds the threshold (default 90%), the system transitions to approach mode.

### 4. Approach

The server tracks the matched person's bounding box across frames and computes movement commands to center and approach them. Rekognition continues running to re-identify the target. When the person fills >15% of the frame, it's considered arrived.

### 5. Delivery

The drone hovers in place. The phone displays the delivery message fullscreen. When "Confirm Delivery" is tapped, the mission completes.

---

## State Machine

```
INPUT --> NAVIGATION --> IDENTIFICATION --> APPROACH --> DELIVERY --> DONE
  |            |                |                |                       |
  |            +----------------+----------------+                       |
  |                        abort -> HOVER                                |
  +----------------------------------------------------------------------+
```

| State | Description | Frame Processing |
|-------|-------------|-----------------|
| `INPUT` | Waiting for mission parameters | None |
| `NAVIGATION` | Following GPS waypoints | Route following |
| `IDENTIFICATION` | Scanning for target person | YOLOv8 person detection -> Rekognition face matching |
| `APPROACH` | Flying toward matched person | YOLOv8 + Rekognition re-matching -> directional commands |
| `DELIVERY` | Hovering, showing message | None (hover) |
| `DONE` | Mission complete | None |
| `HOVER` | Emergency stop (abort) | None (hover) |

---

## Dashboard

The web dashboard at `http://localhost:8765/dashboard` provides:

- **Live video feed** from the phone's screen capture
- **Detect toggle** — enables YOLOv8 person detection on the live feed (runs every 10th frame to preserve FPS)
- **Reference photo status** — shows whether a reference photo has been uploaded
- **Face matching** — when detect is ON and a reference photo is uploaded, crops are matched via Rekognition (green box = match, red box = no match)
- **Mission state** badge, GPS coordinates, FPS counter, waypoint progress
- **Detection list** with confidence percentages

---

## Project Structure

```
Drone/
+-- server/                              # PC backend (Python/FastAPI)
|   +-- main.py                          # FastAPI app, WebSocket, HTTP proxy, dashboard
|   +-- config.py                        # Environment config (.env), constants
|   +-- ws_handler.py                    # WebSocket connection manager, frame pipeline
|   +-- state_machine.py                 # Mission state machine (7 states)
|   +-- requirements.txt                 # Python deps (ultralytics, fastapi, boto3, etc.)
|   +-- navigation/
|   |   +-- geocoder.py                  # Nominatim geocoding
|   |   +-- router.py                    # OSRM routing, polyline decoding
|   |   +-- commander.py                 # GPS -> heading -> movement commands
|   |   +-- obstacle_avoidance.py        # Obstacle detection stub (placeholder)
|   |   +-- geo_utils.py                 # Haversine distance
|   +-- identification/
|   |   +-- person_detector.py           # YOLOv8 nano person detection
|   |   +-- face_matcher.py              # AWS Rekognition CompareFaces
|   |   +-- approach.py                  # Bounding box -> approach commands
|   +-- tests/                           # Unit tests (pytest)
|
+-- phone/                               # Android app (React Native + Kotlin)
|   +-- App.tsx                          # Navigation root (5 screens)
|   +-- src/
|   |   +-- screens/
|   |   |   +-- InputScreen.tsx          # Uber-style booking with waypoints
|   |   |   +-- SettingsScreen.tsx       # Server config, reference photo, drone app picker
|   |   |   +-- WatchScreen.tsx          # Streaming screen
|   |   |   +-- ActionRecorderScreen.tsx # Tap position recorder
|   |   |   +-- DeliveryScreen.tsx       # Delivery confirmation
|   |   +-- services/
|   |   |   +-- WebSocketService.ts      # WebSocket client (reconnect, heartbeat)
|   |   |   +-- ScreenCapture.ts         # Bridge to native MediaProjection
|   |   |   +-- DroneControl.ts          # Bridge to native Accessibility Service
|   |   +-- types/
|   |       +-- protocol.ts             # Shared message type definitions
|   +-- android/app/src/main/java/com/dronecontrol/
|       +-- screencapture/               # MediaProjection screen capture
|       +-- accessibility/               # Gesture injection via Accessibility API
|
+-- README.md
+-- SETUP.md                             # WSL2 setup, adb.exe, deployment guide
+-- IMPLEMENTATION.md                    # AI inference integration guide
```

---

## Setup

See **[SETUP.md](SETUP.md)** for detailed setup instructions including WSL2/adb.exe configuration.

### Quick Start

```bash
# Server
cd server
pip install -r requirements.txt
cp .env.example .env   # fill in AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
python3 main.py

# Phone
cd phone && npm install
cd android && ./gradlew assembleDebug
# Deploy via adb.exe (see SETUP.md)

# Port forwarding
adb.exe reverse tcp:8765 tcp:8765  # Server
adb.exe reverse tcp:8081 tcp:8081  # Metro dev server
```

### Environment Variables

```env
WS_HOST=0.0.0.0
WS_PORT=8765

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key_here
AWS_SECRET_ACCESS_KEY=your_secret_here
REKOGNITION_SIMILARITY_THRESHOLD=90.0

PERSON_CONFIDENCE_THRESHOLD=0.4

WAYPOINT_REACHED_RADIUS_M=10.0
IDENTIFICATION_RANGE_M=50.0
```
