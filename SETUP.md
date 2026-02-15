# SkyHeart Setup Guide

## Prerequisites

- WSL2 (Ubuntu) on Windows
- Android phone with USB debugging enabled
- Node.js 18+, JDK 17, Android SDK
- Python 3.12+

## Important: ADB on WSL2

WSL2 cannot see USB devices natively. You **must** use the Windows `adb.exe` instead of the Linux `adb` package.

- **Do NOT install** the Linux `adb` package (`apt install adb`) -- it will never detect your phone
- Use `adb.exe` which is available from the Windows PATH inside WSL2
- If you have multiple devices (USB + wireless), specify the serial: `adb.exe -s <SERIAL>`

### Deploying the APK from WSL2

Since `adb.exe` can't read WSL2 UNC paths directly, copy the APK to a Windows path first:

```bash
# 1. Build the APK
cd phone/android && ./gradlew assembleDebug

# 2. Copy to a Windows-accessible location
mkdir -p /mnt/c/temp
cp phone/android/app/build/outputs/apk/debug/app-debug.apk /mnt/c/temp/app-debug.apk

# 3. Install via Windows adb
adb.exe install -r 'C:\temp\app-debug.apk'

# If multiple devices are connected, specify the serial:
adb.exe devices                           # list devices
adb.exe -s <SERIAL> install -r 'C:\temp\app-debug.apk'
```

### Port Forwarding

The phone's WiFi is connected to the drone, so all server communication goes over USB:

```bash
adb.exe reverse tcp:8765 tcp:8765    # Python server
adb.exe reverse tcp:8081 tcp:8081    # Metro bundler (dev)
```

USB tunnels drop frequently. Use the keepalive script to auto-re-establish every 3 seconds:

```bash
./adb-tunnel.sh    # runs in foreground, Ctrl+C to stop
```

Or run it in the background: `./adb-tunnel.sh &`

### Restarting the App

```bash
adb.exe shell am force-stop com.dronecontrol
adb.exe shell am start -n com.dronecontrol/.MainActivity
```

## Server Setup

```bash
cd server
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt    # installs ultralytics (YOLOv8), fastapi, boto3, httpx, etc.
python3 main.py                    # starts on 0.0.0.0:8765
```

YOLOv8 nano model (~6MB) pre-loads at server startup with a warmup inference, so first detection is instant. The dashboard shows a loading bar until the model is ready.

### AWS Rekognition Credentials

Face matching requires AWS credentials:

1. Go to [IAM Console](https://console.aws.amazon.com/iam/) -> Users -> Create user
2. Attach the `AmazonRekognitionFullAccess` policy
3. Security credentials tab -> Create access key -> "Application running outside AWS"
4. Copy the Access Key ID and Secret Access Key into `server/.env`:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
REKOGNITION_SIMILARITY_THRESHOLD=90.0
```

### Restarting the Server

```bash
lsof -ti:8765 | xargs kill -9 2>/dev/null
sleep 1
cd server && python3 main.py
```

### Verify

```bash
curl http://localhost:8765/health
# -> {"status":"ok","state":"input","model_ready":true,"model_loading":false}
```

## Phone App Setup

```bash
cd phone
npm install
cd android && ./gradlew assembleDebug
# Then deploy APK using the adb.exe steps above
```

### First Run

1. Open the app -> Settings -> connect to server (`ws://localhost:8765/ws`)
2. Upload a **Reference Photo** of the target person
3. Select the **Drone App** to control
4. Enable **Accessibility Service** (for automated taps)
5. Use **Action Recorder** to record takeoff/landing tap positions
6. Use **Test Video Streaming** to verify the pipeline

## Dashboard

Open `http://localhost:8765/dashboard` in a browser to see:
- Live video feed from the phone
- **Detect** toggle — enables YOLOv8 person detection (runs every 10th frame)
- **Reference Photo** status — shows if a photo has been uploaded
- When both are active, face matching runs via AWS Rekognition (green = match, red = no match)
- Mission state, GPS, FPS stats

## Environment Variables

Full list for `server/.env`:

```env
# Server
WS_HOST=0.0.0.0
WS_PORT=8765

# AWS Rekognition (required for face matching)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
REKOGNITION_SIMILARITY_THRESHOLD=90.0

# Person Detection
PERSON_CONFIDENCE_THRESHOLD=0.4

# Navigation
WAYPOINT_REACHED_RADIUS_M=10.0
IDENTIFICATION_RANGE_M=50.0

# Google Maps (optional, for server-side geocoding fallback)
GOOGLE_MAPS_API_KEY=
```
