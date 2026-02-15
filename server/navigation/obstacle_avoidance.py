"""Obstacle detection from video frames.

Currently disabled — the drone flies its planned route without obstacle detection.
To enable, set OBSTACLE_DETECTION_ENABLED=true in .env and implement a detection
backend (e.g., depth estimation, YOLO, or custom SAM classifier).

The interface is preserved so a proper detection model can be dropped in later.
When an obstacle is detected, the system can trigger a reroute via Google Maps
to replan the remaining route around the obstruction.
"""

import logging
from typing import Callable, Dict, List, Optional

import numpy as np

from config import (
    OBSTACLE_DETECTION_ENABLED,
    OBSTACLE_CENTER_THRESHOLD,
    OBSTACLE_MIN_AREA_FRACTION,
)

logger = logging.getLogger(__name__)

# Type alias for obstacle detection backends
# A backend takes (frame, masks) and returns an avoidance command or None.
ObstacleDetectorBackend = Callable[[np.ndarray, List[Dict]], Optional[Dict]]

# Registry of available backends — add new ones here
_backends: Dict[str, ObstacleDetectorBackend] = {}


def register_backend(name: str, backend: ObstacleDetectorBackend):
    """Register a named obstacle detection backend.

    Example:
        def my_depth_detector(frame, masks):
            # ... depth estimation logic ...
            return {"direction": "up", "intensity": 0.7, "duration_ms": 600}

        register_backend("depth", my_depth_detector)
    """
    _backends[name] = backend
    logger.info("Registered obstacle detection backend: %s", name)


def detect_obstacles(
    frame: np.ndarray,
    masks: List[Dict],
    backend: Optional[str] = None,
) -> Optional[Dict]:
    """Analyze frame for obstacles in the flight path.

    Args:
        frame: BGR image (H, W, 3)
        masks: List of SAM mask dicts with 'segmentation' and 'area'
        backend: Name of registered backend to use. If None, uses default.

    Returns:
        Avoidance command dict if obstacle detected, None if path is clear.
        Command format: {"direction": str, "intensity": float, "duration_ms": int}

    When obstacle detection is disabled (OBSTACLE_DETECTION_ENABLED=false),
    this always returns None so the drone follows its planned route.
    """
    if not OBSTACLE_DETECTION_ENABLED:
        return None

    if not masks:
        return None

    # Use specified backend or fall back to first registered one
    if backend and backend in _backends:
        detector = _backends[backend]
    elif _backends:
        detector = next(iter(_backends.values()))
    else:
        logger.debug("No obstacle detection backend registered")
        return None

    try:
        return detector(frame, masks)
    except Exception:
        logger.exception("Obstacle detection backend failed")
        return None


# ---------------------------------------------------------------------------
# Example placeholder backend (not registered by default)
# ---------------------------------------------------------------------------

def _hsv_sky_detector(frame: np.ndarray, masks: List[Dict]) -> Optional[Dict]:
    """Crude sky-vs-not-sky obstacle detector using HSV color heuristics.

    This is a placeholder implementation. For production use, replace with
    a proper depth estimation model (e.g., MiDaS, ZoeDepth) or object
    detection model (e.g., YOLO) that can reliably identify buildings,
    trees, wires, and other flight-path obstructions.

    To enable: register_backend("hsv_sky", _hsv_sky_detector)
    """
    import cv2

    SKY_HUE_RANGE = (90, 140)
    SKY_SAT_MAX = 150
    SKY_VAL_MIN = 120

    h, w = frame.shape[:2]
    total_pixels = h * w

    center_left = int(w * (0.5 - OBSTACLE_CENTER_THRESHOLD / 2))
    center_right = int(w * (0.5 + OBSTACLE_CENTER_THRESHOLD / 2))
    center_top = int(h * 0.2)
    center_bottom = int(h * 0.9)

    try:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    except Exception:
        return None

    obstacle_in_center = 0
    sky_left = 0
    sky_right = 0
    sky_top = 0

    for mask_info in masks:
        seg = mask_info.get("segmentation")
        if seg is None:
            continue

        area_fraction = mask_info.get("area", 0) / total_pixels
        if area_fraction < OBSTACLE_MIN_AREA_FRACTION:
            continue

        mask_pixels = hsv[seg]
        if len(mask_pixels) == 0:
            continue

        avg_hue = np.mean(mask_pixels[:, 0])
        avg_sat = np.mean(mask_pixels[:, 1])
        avg_val = np.mean(mask_pixels[:, 2])

        is_sky = (SKY_HUE_RANGE[0] <= avg_hue <= SKY_HUE_RANGE[1] and
                  avg_sat < SKY_SAT_MAX and
                  avg_val > SKY_VAL_MIN)

        if is_sky:
            seg_coords = np.where(seg)
            if len(seg_coords[1]) > 0:
                avg_x = np.mean(seg_coords[1])
                avg_y = np.mean(seg_coords[0])
                if avg_x < w / 2:
                    sky_left += area_fraction
                else:
                    sky_right += area_fraction
                if avg_y < h / 3:
                    sky_top += area_fraction
        else:
            center_mask = seg[center_top:center_bottom, center_left:center_right]
            center_coverage = np.sum(center_mask) / max(center_mask.size, 1)
            if center_coverage > 0.3:
                obstacle_in_center += area_fraction

    if obstacle_in_center > 0.15:
        if sky_left > sky_right and sky_left > sky_top:
            direction = "left"
        elif sky_right > sky_left and sky_right > sky_top:
            direction = "right"
        elif sky_top > 0.1:
            direction = "up"
        else:
            direction = "up"

        intensity = min(0.9, obstacle_in_center * 2)
        logger.info("Obstacle detected (%.1f%% center coverage) -> %s (%.1f)",
                    obstacle_in_center * 100, direction, intensity)
        return {
            "direction": direction,
            "intensity": intensity,
            "duration_ms": 600,
        }

    return None
