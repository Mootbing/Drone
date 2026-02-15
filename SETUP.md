# SkyHeart Setup Guide

## Prerequisites

- WSL2 (Ubuntu) on Windows
- Android phone with USB debugging enabled
- Node.js, JDK 17, Android SDK
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
adb.exe -s ZL83237TWM install -r 'C:\temp\app-debug.apk'
```

## Server Setup

```bash
cd server
pip install -r requirements.txt    # installs ultralytics (YOLOv8), fastapi, etc.
python3 main.py                    # starts on 0.0.0.0:8765
```

YOLOv8 nano weights (~6MB) auto-download on first detection run.

### Restarting the server

```bash
# Kill existing server and restart
lsof -ti:8765 | xargs kill -9 2>/dev/null
sleep 1
cd server && python3 main.py
```

### Verify

```bash
curl http://localhost:8765/health
# -> {"status":"ok","state":"input"}
```

## Phone App Setup

```bash
cd phone
npm install
cd android && ./gradlew assembleDebug
# Then deploy APK using the adb.exe steps above
```

## Dashboard

Open `http://localhost:8765/dashboard` in a browser to see:
- Live video feed from the phone
- Person detection bounding boxes (click **Detect** toggle to enable)
- Mission state, GPS, FPS stats
