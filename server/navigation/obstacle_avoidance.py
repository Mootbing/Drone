"""SAM-based obstacle detection from video frames.

Analyzes SAM segmentation masks to identify obstacles in the drone's flight path
and computes avoidance commands.
"""

import logging
from typing import Dict, List, Optional

import cv2
import numpy as np

from config import OBSTACLE_CENTER_THRESHOLD, OBSTACLE_MIN_AREA_FRACTION

logger = logging.getLogger(__name__)

# Heuristic color ranges (HSV) for classifying segments
# Sky tends to be blue/light, obstacles tend to be dark/green/brown
SKY_HUE_RANGE = (90, 140)  # blue hues
SKY_SAT_MAX = 150
SKY_VAL_MIN = 120


def detect_obstacles(
    frame: np.ndarray,
    masks: List[Dict],
) -> Optional[Dict]:
    """Analyze frame + SAM masks for obstacles in the flight path.

    Args:
        frame: BGR image (H, W, 3)
        masks: List of SAM mask dicts with 'segmentation' (bool array) and 'area'

    Returns:
        Avoidance command dict if obstacle detected, None if path is clear.
        Command format: {"direction": str, "intensity": float, "duration_ms": int}
    """
    if not masks:
        return None

    h, w = frame.shape[:2]
    total_pixels = h * w

    # Define center region (where obstacles matter for forward flight)
    center_left = int(w * (0.5 - OBSTACLE_CENTER_THRESHOLD / 2))
    center_right = int(w * (0.5 + OBSTACLE_CENTER_THRESHOLD / 2))
    center_top = int(h * 0.2)  # top 20% is typically sky
    center_bottom = int(h * 0.9)

    # Convert frame to HSV for color classification
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

        # Classify this segment by average color
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
            # Track sky distribution for avoidance direction
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
            # Check if this non-sky segment is in the center (obstacle)
            center_mask = seg[center_top:center_bottom, center_left:center_right]
            center_coverage = np.sum(center_mask) / max(center_mask.size, 1)
            if center_coverage > 0.3:
                obstacle_in_center += area_fraction

    # Decision: if significant obstacle in center, issue avoidance
    if obstacle_in_center > 0.15:
        # Move toward largest sky gap
        if sky_left > sky_right and sky_left > sky_top:
            direction = "left"
        elif sky_right > sky_left and sky_right > sky_top:
            direction = "right"
        elif sky_top > 0.1:
            direction = "up"
        else:
            # Default: go up to clear obstacle
            direction = "up"

        intensity = min(0.9, obstacle_in_center * 2)
        logger.info("Obstacle detected (%.1f%% center coverage) → %s (%.1f)",
                    obstacle_in_center * 100, direction, intensity)
        return {
            "direction": direction,
            "intensity": intensity,
            "duration_ms": 600,
        }

    return None
