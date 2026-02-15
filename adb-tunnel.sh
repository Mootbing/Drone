#!/bin/bash
# Keeps adb.exe reverse tunnels alive over USB.
# Re-establishes every 3 seconds to survive cable hiccups.

echo "=== ADB Tunnel Keepalive ==="
echo "Press Ctrl+C to stop"
echo ""

while true; do
    # Check device connected (strip \r from Windows adb.exe output)
    if adb.exe devices 2>/dev/null | tr -d '\r' | grep -q "device$"; then
        adb.exe reverse tcp:8765 tcp:8765 2>/dev/null && \
        adb.exe reverse tcp:8081 tcp:8081 2>/dev/null && \
        echo "[$(date +%H:%M:%S)] tunnels OK  (8765 + 8081)" || \
        echo "[$(date +%H:%M:%S)] FAILED to set reverse"
    else
        echo "[$(date +%H:%M:%S)] NO DEVICE - waiting..."
    fi
    sleep 3
done
