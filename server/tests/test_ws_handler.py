"""Tests for ws_handler — WebSocket connection manager and message routing."""

import asyncio
import base64
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from state_machine import DroneState
from ws_handler import ConnectionManager
from models.sam_loader import SAMInference


@pytest.fixture
def manager():
    sam = MagicMock(spec=SAMInference)
    sam.generate_masks.return_value = []
    return ConnectionManager(sam)


@pytest.fixture
def mock_ws():
    ws = AsyncMock()
    ws.send_json = AsyncMock()
    ws.close = AsyncMock()
    return ws


class TestConnectionManager:
    @pytest.mark.asyncio
    async def test_connect_accepts_first_client(self, manager, mock_ws):
        result = await manager.connect(mock_ws)
        assert result is True
        mock_ws.accept.assert_called_once()

    @pytest.mark.asyncio
    async def test_connect_rejects_second_client(self, manager, mock_ws):
        ws2 = AsyncMock()
        await manager.connect(mock_ws)
        result = await manager.connect(ws2)
        assert result is False
        ws2.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_disconnect_resets_state(self, manager, mock_ws):
        await manager.connect(mock_ws)
        manager.sm.transition(DroneState.NAVIGATION)
        await manager.disconnect()
        assert manager.ws is None
        assert manager.sm.state == DroneState.INPUT

    @pytest.mark.asyncio
    async def test_disconnect_allows_new_connection(self, manager, mock_ws):
        await manager.connect(mock_ws)
        await manager.disconnect()
        ws2 = AsyncMock()
        result = await manager.connect(ws2)
        assert result is True


class TestMessageRouting:
    @pytest.mark.asyncio
    async def test_invalid_json_logged(self, manager, mock_ws):
        await manager.connect(mock_ws)
        await manager.handle_message("not valid json{{{")
        # Should not crash

    @pytest.mark.asyncio
    async def test_unknown_type_logged(self, manager, mock_ws):
        await manager.connect(mock_ws)
        await manager.handle_message(json.dumps({"type": "unknown_xyz"}))
        # Should not crash

    @pytest.mark.asyncio
    async def test_ping_returns_pong(self, manager, mock_ws):
        await manager.connect(mock_ws)
        await manager.handle_message(json.dumps({"type": "ping"}))
        mock_ws.send_json.assert_called_once()
        call_args = mock_ws.send_json.call_args[0][0]
        assert call_args["type"] == "pong"
        assert "timestamp" in call_args

    @pytest.mark.asyncio
    async def test_status_message_handled(self, manager, mock_ws):
        await manager.connect(mock_ws)
        msg = json.dumps({
            "type": "status",
            "battery": 75,
            "signal": "strong",
            "mode": "navigation",
        })
        await manager.handle_message(msg)
        # Should not crash, no response sent

    @pytest.mark.asyncio
    async def test_abort_transitions_to_hover(self, manager, mock_ws):
        await manager.connect(mock_ws)
        manager.sm.transition(DroneState.NAVIGATION)
        await manager.handle_message(json.dumps({"type": "abort"}))
        assert manager.sm.state == DroneState.HOVER

    @pytest.mark.asyncio
    async def test_abort_sends_hover_command(self, manager, mock_ws):
        await manager.connect(mock_ws)
        manager.sm.transition(DroneState.NAVIGATION)
        await manager.handle_message(json.dumps({"type": "abort"}))
        calls = [c[0][0] for c in mock_ws.send_json.call_args_list]
        hover_cmd = next((c for c in calls if c.get("action") == "hover"), None)
        assert hover_cmd is not None

    @pytest.mark.asyncio
    async def test_delivery_confirmed_transitions_to_done(self, manager, mock_ws):
        await manager.connect(mock_ws)
        # Navigate through states to DELIVERY
        manager.sm.transition(DroneState.NAVIGATION)
        manager.sm.transition(DroneState.IDENTIFICATION)
        manager.sm.transition(DroneState.APPROACH)
        manager.sm.transition(DroneState.DELIVERY)
        await manager.handle_message(json.dumps({"type": "delivery_confirmed"}))
        assert manager.sm.state == DroneState.DONE


class TestMissionInput:
    @pytest.mark.asyncio
    async def test_mission_input_requires_input_state(self, manager, mock_ws):
        await manager.connect(mock_ws)
        manager.sm.transition(DroneState.NAVIGATION)
        msg = json.dumps({
            "type": "mission_input",
            "address": "123 Main St",
            "reference_photo": base64.b64encode(b"fake").decode(),
            "delivery_message": "Hello",
        })
        await manager.handle_message(msg)
        calls = [c[0][0] for c in mock_ws.send_json.call_args_list]
        error = next((c for c in calls if c.get("type") == "error"), None)
        assert error is not None

    @pytest.mark.asyncio
    async def test_mission_input_requires_address(self, manager, mock_ws):
        await manager.connect(mock_ws)
        msg = json.dumps({
            "type": "mission_input",
            "address": "",
            "reference_photo": base64.b64encode(b"fake").decode(),
        })
        await manager.handle_message(msg)
        calls = [c[0][0] for c in mock_ws.send_json.call_args_list]
        error = next((c for c in calls if c.get("type") == "error"), None)
        assert error is not None
        assert "Address" in error["message"]

    @pytest.mark.asyncio
    async def test_mission_input_requires_photo(self, manager, mock_ws):
        await manager.connect(mock_ws)
        msg = json.dumps({
            "type": "mission_input",
            "address": "123 Main St",
            "reference_photo": "",
        })
        await manager.handle_message(msg)
        calls = [c[0][0] for c in mock_ws.send_json.call_args_list]
        error = next((c for c in calls if c.get("type") == "error"), None)
        assert error is not None
        assert "photo" in error["message"].lower()

    @pytest.mark.asyncio
    async def test_mission_input_invalid_base64(self, manager, mock_ws):
        await manager.connect(mock_ws)
        with patch("ws_handler.geocode_address", return_value=(40.7, -74.0)):
            msg = json.dumps({
                "type": "mission_input",
                "address": "123 Main St",
                "reference_photo": "not-valid-base64!!!",
                "delivery_message": "Hello",
            })
            await manager.handle_message(msg)
        calls = [c[0][0] for c in mock_ws.send_json.call_args_list]
        error = next((c for c in calls if c.get("type") == "error"), None)
        assert error is not None

    @pytest.mark.asyncio
    @patch("ws_handler.geocode_address", return_value=(40.7128, -74.0060))
    @patch("ws_handler.get_route_waypoints", return_value=[{"lat": 40.7, "lng": -74.0}])
    async def test_mission_input_success(self, mock_route, mock_geo, manager, mock_ws):
        await manager.connect(mock_ws)
        photo_b64 = base64.b64encode(b"fake_photo_data").decode()
        msg = json.dumps({
            "type": "mission_input",
            "address": "123 Main St, NYC",
            "reference_photo": photo_b64,
            "delivery_message": "Package for you!",
        })
        await manager.handle_message(msg)
        assert manager.sm.state == DroneState.NAVIGATION
        assert manager.sm.context.target_address == "123 Main St, NYC"

    @pytest.mark.asyncio
    @patch("ws_handler.geocode_address", return_value=None)
    async def test_mission_input_geocode_failure(self, mock_geo, manager, mock_ws):
        await manager.connect(mock_ws)
        msg = json.dumps({
            "type": "mission_input",
            "address": "nonexistent place",
            "reference_photo": base64.b64encode(b"photo").decode(),
        })
        await manager.handle_message(msg)
        calls = [c[0][0] for c in mock_ws.send_json.call_args_list]
        error = next((c for c in calls if c.get("type") == "error"), None)
        assert error is not None
        assert "geocode" in error["message"].lower()


class TestFrameProcessing:
    @pytest.mark.asyncio
    async def test_frame_updates_gps(self, manager, mock_ws):
        await manager.connect(mock_ws)
        msg = json.dumps({
            "type": "frame",
            "gps": {"lat": 40.7, "lng": -74.0, "alt": 30.0},
            "frame": "",
        })
        await manager.handle_message(msg)
        assert manager.sm.context.current_lat == 40.7
        assert manager.sm.context.current_lng == -74.0
        assert manager.sm.context.current_alt == 30.0

    @pytest.mark.asyncio
    async def test_frame_invalid_base64_handled(self, manager, mock_ws):
        await manager.connect(mock_ws)
        manager.sm.transition(DroneState.NAVIGATION)
        msg = json.dumps({
            "type": "frame",
            "gps": {"lat": 40.7, "lng": -74.0, "alt": 30.0},
            "frame": "!!!invalid_base64!!!",
        })
        await manager.handle_message(msg)
        # Should not crash

    @pytest.mark.asyncio
    async def test_frame_in_input_state_no_processing(self, manager, mock_ws):
        await manager.connect(mock_ws)
        # In INPUT state, frames should not trigger any commands
        msg = json.dumps({
            "type": "frame",
            "gps": {"lat": 40.7, "lng": -74.0, "alt": 30.0},
            "frame": base64.b64encode(b"fake").decode(),
        })
        await manager.handle_message(msg)
        # Only GPS update, no commands sent
        assert mock_ws.send_json.call_count == 0


class TestSendHelpers:
    @pytest.mark.asyncio
    async def test_send_command(self, manager, mock_ws):
        await manager.connect(mock_ws)
        await manager.send_command("forward", 0.5, 500)
        call = mock_ws.send_json.call_args[0][0]
        assert call["type"] == "command"
        assert call["action"] == "move"
        assert call["direction"] == "forward"
        assert call["intensity"] == 0.5

    @pytest.mark.asyncio
    async def test_send_hover(self, manager, mock_ws):
        await manager.connect(mock_ws)
        await manager.send_hover()
        call = mock_ws.send_json.call_args[0][0]
        assert call["action"] == "hover"
        assert call["intensity"] == 0.0

    @pytest.mark.asyncio
    async def test_send_mode_change(self, manager, mock_ws):
        await manager.connect(mock_ws)
        await manager.send_mode_change("navigation", "Route planned")
        call = mock_ws.send_json.call_args[0][0]
        assert call["type"] == "mode_change"
        assert call["mode"] == "navigation"
        assert call["message"] == "Route planned"

    @pytest.mark.asyncio
    async def test_send_json_noop_when_disconnected(self, manager):
        # No websocket connected
        await manager.send_json({"type": "test"})
        # Should not crash
