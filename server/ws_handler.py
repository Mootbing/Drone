"""WebSocket connection manager for phone ↔ PC communication."""

import asyncio
import base64
import json
import logging
import time
from typing import Optional, List

import cv2
import numpy as np
from fastapi import WebSocket

from config import IDENTIFICATION_RANGE_M, WAYPOINT_REACHED_RADIUS_M, REKOGNITION_SIMILARITY_THRESHOLD
from state_machine import StateMachine, DroneState
from navigation.geocoder import geocode_address
from navigation.router import get_route_waypoints
from navigation.commander import compute_navigation_command
from navigation.obstacle_avoidance import detect_obstacles
from identification.person_detector import PersonDetector
from identification.face_matcher import compare_face
from identification.approach import compute_approach_command
from navigation.geo_utils import haversine_m

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages a single phone WebSocket connection and processes frames."""

    def __init__(self):
        self.ws: Optional[WebSocket] = None
        self.sm = StateMachine()
        self.person_detector = PersonDetector()
        self.detect_enabled: bool = False
        self.reference_photo_bytes: Optional[bytes] = None
        self._detect_interval: int = 10  # run YOLO every Nth frame
        self._detect_frame_counter: int = 0
        self._cached_detections: list = []
        # Dashboard viewers
        self.dashboard_clients: List[WebSocket] = []
        self.latest_frame_b64: Optional[str] = None
        self.latest_detections: list = []
        self.frame_count: int = 0
        self.fps: float = 0.0
        self._fps_ts: float = time.time()
        self._fps_count: int = 0

    async def connect(self, websocket: WebSocket):
        if self.ws is not None:
            await websocket.close(code=1008, reason="Another client is already connected")
            return False
        await websocket.accept()
        self.ws = websocket
        logger.info("Phone connected")
        return True

    async def disconnect(self):
        self.ws = None
        self.sm = StateMachine()  # reset state for next connection
        logger.info("Phone disconnected")

    async def send_json(self, data: dict):
        if self.ws:
            await self.ws.send_json(data)

    async def send_command(self, direction: str, intensity: float, duration_ms: int = 500):
        await self.send_json({
            "type": "command",
            "action": "move",
            "direction": direction,
            "intensity": intensity,
            "duration_ms": duration_ms,
        })

    async def send_mode_change(self, mode: str, message: str):
        await self.send_json({
            "type": "mode_change",
            "mode": mode,
            "message": message,
        })

    async def send_hover(self):
        await self.send_json({
            "type": "command",
            "action": "hover",
            "direction": "none",
            "intensity": 0.0,
            "duration_ms": 0,
        })

    # --- Dashboard ---

    async def dashboard_connect(self, ws: WebSocket):
        await ws.accept()
        self.dashboard_clients.append(ws)
        logger.info("Dashboard client connected (%d total)", len(self.dashboard_clients))

    async def dashboard_disconnect(self, ws: WebSocket):
        if ws in self.dashboard_clients:
            self.dashboard_clients.remove(ws)
        logger.info("Dashboard client disconnected (%d remaining)", len(self.dashboard_clients))

    async def _broadcast_dashboard(self, frame_b64: str, detections: list):
        """Send frame + detections to all dashboard viewers.

        Sends two messages per frame for efficiency:
        1. Binary message with raw JPEG bytes (no base64 overhead)
        2. Text message with JSON metadata (state, detections, GPS, etc.)
        """
        if not self.dashboard_clients:
            return

        # Decode base64 once, send raw JPEG bytes to all clients
        try:
            frame_bytes = base64.b64decode(frame_b64)
        except Exception:
            return

        ctx = self.sm.context
        meta = json.dumps({
            "type": "meta",
            "state": self.sm.state.value,
            "detections": detections,
            "gps": {"lat": ctx.current_lat, "lng": ctx.current_lng, "alt": ctx.current_alt},
            "fps": round(self.fps, 1),
            "frame_count": self.frame_count,
            "waypoint": f"{ctx.current_waypoint_idx}/{len(ctx.waypoints)}" if ctx.waypoints else "—",
            "target_address": ctx.target_address,
            "detect_enabled": self.detect_enabled,
            "has_reference": self.reference_photo_bytes is not None,
        })
        stale = []
        for client in self.dashboard_clients:
            try:
                await client.send_bytes(frame_bytes)
                await client.send_text(meta)
            except Exception:
                stale.append(client)
        for s in stale:
            if s in self.dashboard_clients:
                self.dashboard_clients.remove(s)

    # --- Message routing ---

    async def handle_message(self, raw: str):
        """Route incoming JSON message from phone."""
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            logger.error("Invalid JSON from phone")
            return

        msg_type = msg.get("type")
        if msg_type == "frame":
            await self._handle_frame(msg)
        elif msg_type == "status":
            self._handle_status(msg)
        elif msg_type == "mission_input":
            await self._handle_mission_input(msg)
        elif msg_type == "abort":
            await self._handle_abort()
        elif msg_type == "delivery_confirmed":
            await self._handle_delivery_confirmed()
        elif msg_type == "reference_photo":
            self._handle_reference_photo(msg)
        elif msg_type == "ping":
            await self.send_json({"type": "pong", "timestamp": time.time()})
        else:
            logger.warning("Unknown message type: %s", msg_type)

    # --- Handlers ---

    async def _handle_mission_input(self, msg: dict):
        """Process mission start: address + reference photo + delivery message."""
        if self.sm.state != DroneState.INPUT:
            await self.send_json({
                "type": "error",
                "message": "Cannot start new mission in current state",
            })
            return

        address = msg.get("address", "").strip()[:500]
        reference_b64 = msg.get("reference_photo", "")
        delivery_message = msg.get("delivery_message", "")

        if not address:
            await self.send_json({"type": "error", "message": "Address is required"})
            return
        if not reference_b64:
            await self.send_json({"type": "error", "message": "Reference photo is required"})
            return

        # Geocode address
        result = geocode_address(address)
        if result is None:
            await self.send_json({
                "type": "error",
                "message": f"Could not geocode address: {address}",
            })
            return

        lat, lng = result
        try:
            reference_bytes = base64.b64decode(reference_b64)
        except Exception:
            await self.send_json({"type": "error", "message": "Invalid reference photo data"})
            return

        self.sm.set_target(address, lat, lng, reference_bytes, delivery_message)

        # Use phone-provided waypoints (turn-by-turn) if available
        phone_waypoints = msg.get("waypoints")
        if phone_waypoints and len(phone_waypoints) > 0:
            waypoints = [{"lat": wp["lat"], "lng": wp["lng"]} for wp in phone_waypoints]
            logger.info("Using %d waypoints from phone", len(waypoints))
        else:
            # Fallback: compute route server-side
            if msg.get("gps"):
                start_lat = msg["gps"]["lat"]
                start_lng = msg["gps"]["lng"]
            else:
                start_lat, start_lng = lat, lng
            waypoints = get_route_waypoints(start_lat, start_lng, lat, lng)
        self.sm.set_route(waypoints)

        # Transition to navigation
        self.sm.transition(DroneState.NAVIGATION)
        await self.send_mode_change("navigation",
                                    f"Route planned: {len(waypoints)} waypoints to {address}")

    async def _handle_frame(self, msg: dict):
        """Process a video frame based on current state."""
        # Update GPS
        gps = msg.get("gps", {})
        if gps:
            self.sm.update_position(
                gps.get("lat", 0), gps.get("lng", 0), gps.get("alt", 0)
            )

        # Decode frame
        frame_b64 = msg.get("frame", "")
        if not frame_b64:
            return

        # Track FPS
        self.frame_count += 1
        self._fps_count += 1
        now = time.time()
        elapsed = now - self._fps_ts
        if elapsed >= 1.0:
            self.fps = self._fps_count / elapsed
            self._fps_count = 0
            self._fps_ts = now

        # Store for dashboard
        self.latest_frame_b64 = frame_b64

        try:
            frame_bytes = base64.b64decode(frame_b64)
        except Exception:
            logger.warning("Invalid base64 frame data")
            return
        frame_arr = _decode_jpeg(frame_bytes)
        if frame_arr is None:
            return

        state = self.sm.state
        detections: list = []

        if state == DroneState.NAVIGATION:
            await self._process_navigation(frame_arr)
        elif state == DroneState.IDENTIFICATION:
            detections = await self._process_identification(frame_arr)
        elif state == DroneState.APPROACH:
            detections = await self._process_approach(frame_arr)
        elif self.detect_enabled:
            detections = await self._process_detect_only(frame_arr)

        self.latest_detections = detections
        await self._broadcast_dashboard(frame_b64, detections)

    async def _process_navigation(self, frame: np.ndarray):
        """Navigation mode: follow waypoints, with optional obstacle avoidance."""
        ctx = self.sm.context

        # Check if we've reached the destination zone
        dist = haversine_m(ctx.current_lat, ctx.current_lng,
                            ctx.target_lat, ctx.target_lng)
        if dist < IDENTIFICATION_RANGE_M:
            self.sm.transition(DroneState.IDENTIFICATION)
            await self.send_mode_change("identification",
                                        "Arrived at target zone, scanning for people...")
            return

        # Advance waypoint if close enough
        if ctx.current_waypoint_idx < len(ctx.waypoints):
            wp = ctx.waypoints[ctx.current_waypoint_idx]
            wp_dist = haversine_m(ctx.current_lat, ctx.current_lng,
                                   wp["lat"], wp["lng"])
            if wp_dist < WAYPOINT_REACHED_RADIUS_M:
                ctx.current_waypoint_idx += 1
                logger.info("Reached waypoint %d/%d",
                            ctx.current_waypoint_idx, len(ctx.waypoints))

        # Obstacle detection (stub — always returns None)
        obstacle_cmd = detect_obstacles(frame)

        if obstacle_cmd:
            # Obstacle avoidance takes priority — optionally reroute
            await self.send_command(
                obstacle_cmd["direction"],
                obstacle_cmd["intensity"],
                obstacle_cmd.get("duration_ms", 500),
            )
            # Trigger reroute if the obstacle requires path replanning
            if obstacle_cmd.get("reroute"):
                await self._reroute_from_current_position()
        else:
            # Follow planned route
            if ctx.current_waypoint_idx < len(ctx.waypoints):
                wp = ctx.waypoints[ctx.current_waypoint_idx]
                cmd = compute_navigation_command(
                    ctx.current_lat, ctx.current_lng,
                    wp["lat"], wp["lng"],
                )
                await self.send_command(cmd["direction"], cmd["intensity"])
            else:
                # Past last waypoint, head to target
                cmd = compute_navigation_command(
                    ctx.current_lat, ctx.current_lng,
                    ctx.target_lat, ctx.target_lng,
                )
                await self.send_command(cmd["direction"], cmd["intensity"])

    async def _reroute_from_current_position(self):
        """Replan route from current GPS to target via Google Maps.

        Called when obstacle detection triggers a reroute. Gets fresh
        waypoints from the Directions API starting from the drone's
        current position, replacing the remaining route.
        """
        ctx = self.sm.context
        try:
            waypoints = get_route_waypoints(
                ctx.current_lat, ctx.current_lng,
                ctx.target_lat, ctx.target_lng,
            )
            ctx.waypoints = waypoints
            ctx.current_waypoint_idx = 0
            logger.info("Rerouted: %d new waypoints from current position", len(waypoints))
            await self.send_json({
                "type": "mode_change",
                "mode": "navigation",
                "message": f"Rerouted: {len(waypoints)} waypoints to destination",
            })
        except Exception:
            logger.exception("Reroute failed, continuing on current path")

    async def _process_identification(self, frame: np.ndarray) -> list:
        """Identification mode: find and match target person."""
        ctx = self.sm.context
        detections = []
        persons = await asyncio.get_event_loop().run_in_executor(
            None, self.person_detector.detect, frame
        )

        if not persons:
            # Rotate slowly to scan
            await self.send_command("rotate_cw", 0.3, 800)
            return detections

        # Try matching each detected person
        for person in persons:
            bbox = person["bbox"]
            face_crop = frame[bbox[1]:bbox[3], bbox[0]:bbox[2]]
            det = {"bbox": bbox, "type": "person", "matched": False, "confidence": 0}

            if ctx.reference_photo_bytes is None:
                detections.append(det)
                continue

            match_result = compare_face(ctx.reference_photo_bytes, face_crop)
            if match_result:
                det["confidence"] = match_result["confidence"]
            if match_result and match_result["confidence"] >= REKOGNITION_SIMILARITY_THRESHOLD:
                det["matched"] = True
                detections.append(det)
                ctx.target_bbox = bbox
                ctx.match_confidence = match_result["confidence"]
                self.sm.transition(DroneState.APPROACH)
                await self.send_json({
                    "type": "identified",
                    "match": True,
                    "confidence": match_result["confidence"],
                    "person_bbox": bbox,
                    "action": "approach",
                })
                await self.send_mode_change("approach",
                                            f"Target identified ({match_result['confidence']:.0f}% confidence). Approaching...")
                return detections
            detections.append(det)

        # No match found yet, keep scanning
        await self.send_command("rotate_cw", 0.2, 600)
        return detections

    async def _process_approach(self, frame: np.ndarray) -> list:
        """Approach mode: fly toward identified person."""
        ctx = self.sm.context
        detections = []
        persons = await asyncio.get_event_loop().run_in_executor(
            None, self.person_detector.detect, frame
        )

        # Re-match to track the person
        best_bbox = None
        best_conf = 0.0
        for person in persons:
            bbox = person["bbox"]
            face_crop = frame[bbox[1]:bbox[3], bbox[0]:bbox[2]]
            det = {"bbox": bbox, "type": "person", "matched": False, "confidence": 0}
            if ctx.reference_photo_bytes is None:
                detections.append(det)
                continue
            match_result = compare_face(ctx.reference_photo_bytes, face_crop)
            if match_result:
                det["confidence"] = match_result["confidence"]
                if match_result["confidence"] > best_conf:
                    best_conf = match_result["confidence"]
                    best_bbox = bbox
                    det["matched"] = True
            detections.append(det)

        if best_bbox is None:
            # Lost track, go back to identification
            self.sm.transition(DroneState.IDENTIFICATION)
            await self.send_mode_change("identification",
                                        "Lost visual on target, rescanning...")
            return detections

        cmd = compute_approach_command(best_bbox, frame.shape[1], frame.shape[0])
        if cmd.get("arrived"):
            self.sm.transition(DroneState.DELIVERY)
            await self.send_mode_change("delivery", ctx.delivery_message)
            await self.send_hover()
        else:
            await self.send_command(cmd["direction"], cmd["intensity"], cmd.get("duration_ms", 500))
        return detections

    async def _process_detect_only(self, frame: np.ndarray) -> list:
        """Run person detection and optional face matching.

        Only runs YOLO every N frames to maintain high FPS.
        Reuses cached detections for in-between frames.
        When a reference photo is available, runs Rekognition on each crop.
        """
        self._detect_frame_counter += 1
        if self._detect_frame_counter % self._detect_interval != 1 and self._cached_detections:
            return self._cached_detections

        persons = await asyncio.get_event_loop().run_in_executor(
            None, self.person_detector.detect, frame
        )

        detections = []
        for p in persons:
            bbox = p["bbox"]
            det = {"bbox": bbox, "type": "person", "matched": False,
                   "confidence": round(p["confidence"] * 100, 1)}

            if self.reference_photo_bytes:
                face_crop = frame[bbox[1]:bbox[3], bbox[0]:bbox[2]]
                match_result = await asyncio.get_event_loop().run_in_executor(
                    None, compare_face, self.reference_photo_bytes, face_crop
                )
                if match_result:
                    det["confidence"] = match_result["confidence"]
                    if match_result["confidence"] >= REKOGNITION_SIMILARITY_THRESHOLD:
                        det["matched"] = True

            detections.append(det)

        self._cached_detections = detections
        return self._cached_detections

    async def handle_dashboard_message(self, raw: str):
        """Handle incoming messages from dashboard clients."""
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return
        if msg.get("type") == "toggle_detect":
            self.detect_enabled = not self.detect_enabled
            logger.info("Detection toggle: %s", "ON" if self.detect_enabled else "OFF")

    def _handle_reference_photo(self, msg: dict):
        """Store reference photo for face matching."""
        photo_b64 = msg.get("photo", "")
        if photo_b64:
            try:
                self.reference_photo_bytes = base64.b64decode(photo_b64)
                logger.info("Reference photo received (%d bytes)", len(self.reference_photo_bytes))
            except Exception:
                logger.warning("Invalid reference photo data")
        else:
            self.reference_photo_bytes = None
            logger.info("Reference photo cleared")

    def _handle_status(self, msg: dict):
        """Log phone status updates."""
        logger.info("Phone status: battery=%s signal=%s mode=%s",
                    msg.get("battery"), msg.get("signal"), msg.get("mode"))

    async def _handle_abort(self):
        """Handle abort command."""
        self.sm.abort()
        await self.send_hover()
        await self.send_mode_change("hover", "Mission aborted — drone hovering.")

    async def _handle_delivery_confirmed(self):
        """Handle delivery confirmation from phone."""
        self.sm.transition(DroneState.DONE)
        await self.send_mode_change("done", "Mission complete. Delivery confirmed.")
        logger.info("Delivery confirmed. Mission complete.")


def _decode_jpeg(data: bytes) -> Optional[np.ndarray]:
    """Decode JPEG bytes to numpy array (BGR)."""
    try:
        arr = np.frombuffer(data, dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception:
        logger.exception("Failed to decode JPEG frame")
        return None
