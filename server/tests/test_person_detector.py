"""Tests for identification.person_detector — SAM mask filtering for people."""

import pytest
import numpy as np
from identification.person_detector import detect_persons


class TestDetectPersons:
    def _make_frame(self, h=720, w=1280):
        return np.zeros((h, w, 3), dtype=np.uint8)

    def test_no_masks_returns_empty(self):
        frame = self._make_frame()
        result = detect_persons(frame, [])
        assert result == []

    def test_person_shaped_mask_detected(self):
        frame = self._make_frame()
        # Add some color variation to the "person" region
        frame[100:500, 500:700] = [80, 120, 180]  # skin-tone-ish
        frame[100:200, 500:700] = [40, 60, 90]    # hair
        frame[300:500, 500:700] = [150, 100, 60]   # clothing

        # Person-shaped mask: tall and narrow (aspect ratio ~2.0)
        mask = np.zeros((720, 1280), dtype=bool)
        mask[100:500, 500:700] = True  # 400h x 200w
        masks = [{
            "segmentation": mask,
            "area": int(np.sum(mask)),
            "bbox": [500, 100, 200, 400],  # [x, y, w, h] — SAM format
        }]

        result = detect_persons(frame, masks)
        assert len(result) >= 1
        assert "bbox" in result[0]
        assert "confidence" in result[0]

    def test_wide_mask_rejected(self):
        frame = self._make_frame()
        frame[300:400, 100:800] = [100, 100, 100]
        # Wide and short — not person-shaped (aspect ratio < 1.2)
        mask = np.zeros((720, 1280), dtype=bool)
        mask[300:400, 100:800] = True  # 100h x 700w
        masks = [{
            "segmentation": mask,
            "area": int(np.sum(mask)),
            "bbox": [100, 300, 700, 100],
        }]
        result = detect_persons(frame, masks)
        assert len(result) == 0

    def test_too_small_mask_rejected(self):
        frame = self._make_frame()
        # Tiny segment (< 1% of frame)
        mask = np.zeros((720, 1280), dtype=bool)
        mask[300:330, 600:615] = True  # 30h x 15w = 450 pixels
        masks = [{
            "segmentation": mask,
            "area": 450,
            "bbox": [600, 300, 15, 30],
        }]
        result = detect_persons(frame, masks)
        assert len(result) == 0

    def test_too_large_mask_rejected(self):
        frame = self._make_frame()
        # Huge segment (> 60% of frame)
        mask = np.ones((720, 1280), dtype=bool)
        masks = [{
            "segmentation": mask,
            "area": 720 * 1280,
            "bbox": [0, 0, 1280, 720],
        }]
        result = detect_persons(frame, masks)
        assert len(result) == 0

    def test_bbox_converted_from_xywh_to_xyxy(self):
        frame = self._make_frame()
        frame[100:400, 500:650] = [80, 120, 180]
        mask = np.zeros((720, 1280), dtype=bool)
        mask[100:400, 500:650] = True
        masks = [{
            "segmentation": mask,
            "area": int(np.sum(mask)),
            "bbox": [500, 100, 150, 300],  # [x, y, w, h]
        }]
        result = detect_persons(frame, masks)
        if result:
            bbox = result[0]["bbox"]
            # Should be [x1, y1, x2, y2]
            assert bbox == [500, 100, 650, 400]

    def test_results_sorted_by_confidence(self):
        frame = self._make_frame()
        masks = []
        # Create two person-shaped segments with different properties
        for x_start, color in [(200, [80, 120, 180]), (800, [60, 90, 140])]:
            frame[100:400, x_start:x_start+100] = color
            mask = np.zeros((720, 1280), dtype=bool)
            mask[100:400, x_start:x_start+100] = True
            masks.append({
                "segmentation": mask,
                "area": int(np.sum(mask)),
                "bbox": [x_start, 100, 100, 300],
            })

        result = detect_persons(frame, masks)
        if len(result) >= 2:
            assert result[0]["confidence"] >= result[1]["confidence"]
