"""Guide drone toward an identified person based on their bounding box position."""

import logging
from typing import Dict

logger = logging.getLogger(__name__)

# When the person bbox occupies this fraction of frame, consider "arrived"
ARRIVAL_AREA_THRESHOLD = 0.15
# Dead zone in center of frame (fraction) — no correction needed
CENTER_DEAD_ZONE = 0.15


def compute_approach_command(
    bbox: list,
    frame_width: int,
    frame_height: int,
) -> Dict:
    """Compute movement command to fly toward a person's bounding box.

    Args:
        bbox: [x1, y1, x2, y2] pixel coordinates of the person.
        frame_width: Frame width in pixels.
        frame_height: Frame height in pixels.

    Returns:
        Command dict. If close enough, includes "arrived": True.
    """
    x1, y1, x2, y2 = bbox
    bbox_w = x2 - x1
    bbox_h = y2 - y1
    bbox_area = bbox_w * bbox_h
    frame_area = frame_width * frame_height

    area_fraction = bbox_area / max(frame_area, 1)

    # Check if close enough (person fills enough of frame)
    if area_fraction > ARRIVAL_AREA_THRESHOLD:
        logger.info("Approach complete: person occupies %.1f%% of frame", area_fraction * 100)
        return {"arrived": True}

    # Compute center of bbox relative to frame center
    bbox_cx = (x1 + x2) / 2
    bbox_cy = (y1 + y2) / 2
    frame_cx = max(frame_width / 2, 1)
    frame_cy = max(frame_height / 2, 1)

    # Normalized offsets (-1 to 1)
    offset_x = (bbox_cx - frame_cx) / frame_cx
    offset_y = (bbox_cy - frame_cy) / frame_cy

    # Determine primary direction
    abs_x = abs(offset_x)
    abs_y = abs(offset_y)

    # If person is roughly centered, move forward
    if abs_x < CENTER_DEAD_ZONE and abs_y < CENTER_DEAD_ZONE:
        return {
            "direction": "forward",
            "intensity": 0.4,
            "duration_ms": 400,
        }

    # Prioritize larger offset
    if abs_x > abs_y:
        direction = "right" if offset_x > 0 else "left"
        intensity = min(abs_x, 0.8)
    else:
        # Y offset: person above center → go up, below → go down
        direction = "down" if offset_y > 0 else "up"
        intensity = min(abs_y, 0.8)

    logger.debug("Approach: offset=(%.2f, %.2f) → %s @ %.2f",
                 offset_x, offset_y, direction, intensity)

    return {
        "direction": direction,
        "intensity": intensity,
        "duration_ms": 400,
    }
