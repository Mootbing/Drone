"""SAM-based person detection from segmentation masks.

Uses heuristics (aspect ratio, size, position) to filter SAM masks
for person-shaped segments.
"""

import logging
from typing import Dict, List

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Person segment heuristics
MIN_PERSON_HEIGHT_FRACTION = 0.1   # at least 10% of frame height
MAX_PERSON_WIDTH_FRACTION = 0.5    # at most 50% of frame width
MIN_ASPECT_RATIO = 1.2             # height/width — people are taller than wide
MAX_ASPECT_RATIO = 5.0
MIN_AREA_FRACTION = 0.01           # minimum 1% of frame
MAX_AREA_FRACTION = 0.6            # maximum 60% of frame


def detect_persons(
    frame: np.ndarray,
    masks: List[Dict],
) -> List[Dict]:
    """Filter SAM masks for person-shaped segments.

    Args:
        frame: BGR image (H, W, 3)
        masks: SAM mask dicts with 'segmentation', 'area', 'bbox'

    Returns:
        List of person detections, each with:
          - 'bbox': [x1, y1, x2, y2] (pixel coordinates)
          - 'area': int
          - 'mask': bool array
          - 'confidence': float (heuristic score)
    """
    h, w = frame.shape[:2]
    total_pixels = h * w
    persons = []

    for mask_info in masks:
        seg = mask_info.get("segmentation")
        area = mask_info.get("area", 0)
        bbox_xywh = mask_info.get("bbox", [0, 0, 0, 0])

        if seg is None:
            continue

        # Convert bbox from [x, y, w, h] to [x1, y1, x2, y2]
        bx, by, bw, bh = bbox_xywh
        x1, y1 = int(bx), int(by)
        x2, y2 = int(bx + bw), int(by + bh)

        # Size checks
        area_fraction = area / total_pixels
        if area_fraction < MIN_AREA_FRACTION or area_fraction > MAX_AREA_FRACTION:
            continue

        # Aspect ratio check (height/width)
        if bw == 0 or bh == 0:
            continue
        aspect_ratio = bh / bw
        if aspect_ratio < MIN_ASPECT_RATIO or aspect_ratio > MAX_ASPECT_RATIO:
            continue

        # Height check
        height_fraction = bh / h
        if height_fraction < MIN_PERSON_HEIGHT_FRACTION:
            continue

        # Width check
        width_fraction = bw / w
        if width_fraction > MAX_PERSON_WIDTH_FRACTION:
            continue

        # Color heuristic: people tend to have skin-tone or clothing colors,
        # not sky-blue or pure green. Check if segment has varied colors.
        try:
            mask_pixels = frame[seg]
            if len(mask_pixels) < 10:
                continue
            hsv_pixels = cv2.cvtColor(mask_pixels.reshape(1, -1, 3), cv2.COLOR_BGR2HSV)
            color_std = np.std(hsv_pixels[0, :, 0])  # hue variation
            # People/clothing have moderate color variation
            # Pure sky or grass would have low variation
        except Exception:
            color_std = 30  # assume moderate if we can't compute

        # Compute heuristic confidence
        # Better score for: medium size, good aspect ratio, moderate color variation
        confidence = 0.5
        if 1.5 <= aspect_ratio <= 3.5:
            confidence += 0.2
        if 0.02 <= area_fraction <= 0.3:
            confidence += 0.15
        if color_std > 15:
            confidence += 0.15

        persons.append({
            "bbox": [x1, y1, x2, y2],
            "area": area,
            "mask": seg,
            "confidence": min(confidence, 1.0),
        })

    # Sort by confidence descending
    persons.sort(key=lambda p: p["confidence"], reverse=True)

    logger.info("Detected %d person candidates from %d masks", len(persons), len(masks))
    return persons
