"""Tests for navigation.obstacle_avoidance — pluggable obstacle detection."""

import pytest
import numpy as np
from unittest.mock import patch
from navigation.obstacle_avoidance import (
    detect_obstacles,
    register_backend,
    _backends,
    _hsv_sky_detector,
)


class TestDetectObstaclesDisabled:
    """When OBSTACLE_DETECTION_ENABLED=false (default), always returns None."""

    def _make_frame(self, h=720, w=1280):
        return np.zeros((h, w, 3), dtype=np.uint8)

    def test_returns_none_when_disabled(self):
        frame = self._make_frame()
        mask = np.zeros((720, 1280), dtype=bool)
        mask[100:600, 400:900] = True
        masks = [{"segmentation": mask, "area": int(np.sum(mask))}]
        result = detect_obstacles(frame, masks)
        assert result is None

    def test_no_masks_returns_none(self):
        frame = self._make_frame()
        result = detect_obstacles(frame, [])
        assert result is None


class TestDetectObstaclesEnabled:
    """When OBSTACLE_DETECTION_ENABLED=true with registered backends."""

    def _make_frame(self, h=720, w=1280):
        return np.zeros((h, w, 3), dtype=np.uint8)

    def setup_method(self):
        _backends.clear()

    def teardown_method(self):
        _backends.clear()

    @patch("navigation.obstacle_avoidance.OBSTACLE_DETECTION_ENABLED", True)
    def test_no_backend_returns_none(self):
        frame = self._make_frame()
        masks = [{"segmentation": np.ones((720, 1280), dtype=bool), "area": 720 * 1280}]
        result = detect_obstacles(frame, masks)
        assert result is None

    @patch("navigation.obstacle_avoidance.OBSTACLE_DETECTION_ENABLED", True)
    def test_registered_backend_called(self):
        def fake_detector(frame, masks):
            return {"direction": "left", "intensity": 0.5, "duration_ms": 500}

        register_backend("fake", fake_detector)
        frame = self._make_frame()
        masks = [{"segmentation": np.ones((720, 1280), dtype=bool), "area": 720 * 1280}]
        result = detect_obstacles(frame, masks)
        assert result is not None
        assert result["direction"] == "left"

    @patch("navigation.obstacle_avoidance.OBSTACLE_DETECTION_ENABLED", True)
    def test_named_backend_selected(self):
        def backend_a(frame, masks):
            return {"direction": "left", "intensity": 0.5, "duration_ms": 500}

        def backend_b(frame, masks):
            return {"direction": "right", "intensity": 0.9, "duration_ms": 600}

        register_backend("a", backend_a)
        register_backend("b", backend_b)
        frame = self._make_frame()
        masks = [{"segmentation": np.ones((720, 1280), dtype=bool), "area": 720 * 1280}]
        result = detect_obstacles(frame, masks, backend="b")
        assert result["direction"] == "right"

    @patch("navigation.obstacle_avoidance.OBSTACLE_DETECTION_ENABLED", True)
    def test_backend_exception_returns_none(self):
        def bad_detector(frame, masks):
            raise RuntimeError("boom")

        register_backend("bad", bad_detector)
        frame = self._make_frame()
        masks = [{"segmentation": np.ones((720, 1280), dtype=bool), "area": 720 * 1280}]
        result = detect_obstacles(frame, masks)
        assert result is None

    @patch("navigation.obstacle_avoidance.OBSTACLE_DETECTION_ENABLED", True)
    def test_no_masks_returns_none_even_enabled(self):
        register_backend("fake", lambda f, m: {"direction": "up"})
        frame = self._make_frame()
        result = detect_obstacles(frame, [])
        assert result is None


class TestHsvSkyDetector:
    """Tests for the placeholder HSV sky detector backend."""

    def _make_frame(self, h=720, w=1280):
        return np.zeros((h, w, 3), dtype=np.uint8)

    def test_obstacle_in_center_detected(self):
        frame = self._make_frame()
        frame[100:600, 400:900] = [30, 30, 30]
        mask = np.zeros((720, 1280), dtype=bool)
        mask[100:600, 400:900] = True
        masks = [{"segmentation": mask, "area": int(np.sum(mask))}]
        result = _hsv_sky_detector(frame, masks)
        assert result is not None
        assert result["direction"] in ("left", "right", "up")
        assert "duration_ms" in result
        assert result["duration_ms"] > 0

    def test_small_obstacle_ignored(self):
        frame = self._make_frame()
        mask = np.zeros((720, 1280), dtype=bool)
        mask[300:320, 600:620] = True
        masks = [{"segmentation": mask, "area": 400}]
        result = _hsv_sky_detector(frame, masks)
        assert result is None

    def test_sky_clear_returns_none(self):
        frame = self._make_frame()
        frame[:] = [230, 180, 100]
        mask = np.ones((720, 1280), dtype=bool)
        masks = [{"segmentation": mask, "area": 720 * 1280}]
        result = _hsv_sky_detector(frame, masks)
        assert result is None

    def test_no_masks_returns_none(self):
        frame = self._make_frame()
        result = _hsv_sky_detector(frame, [])
        assert result is None
