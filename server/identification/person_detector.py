"""YOLOv8-based person detection.

Uses YOLOv8 nano for fast, accurate person detection (~20-50ms on CPU).
Model weights (~6MB) auto-download on first run.
"""

import logging
from typing import Dict, List

import numpy as np

from config import PERSON_CONFIDENCE_THRESHOLD

logger = logging.getLogger(__name__)


class PersonDetector:
    """YOLOv8 nano person detector."""

    def __init__(self):
        self._model = None
        self.model_ready: bool = False
        self.model_loading: bool = False

    def load(self):
        """Load the YOLO model. Can be called from a thread at startup."""
        if self._model is not None:
            return
        self.model_loading = True
        from ultralytics import YOLO
        logger.info("Loading YOLOv8n model...")
        self._model = YOLO("yolov8n.pt")
        # Warm up with a dummy frame so first real inference isn't slow
        self._model(np.zeros((64, 64, 3), dtype=np.uint8), verbose=False)
        self.model_loading = False
        self.model_ready = True
        logger.info("YOLOv8n model loaded and warmed up")

    def _load(self):
        """Lazy-load fallback if not pre-loaded at startup."""
        if self._model is not None:
            return
        self.load()

    def detect(self, frame: np.ndarray) -> List[Dict]:
        """Detect persons in a BGR frame.

        Args:
            frame: BGR image (H, W, 3)

        Returns:
            List of person detections, each with:
              - 'bbox': [x1, y1, x2, y2] (pixel coordinates, int)
              - 'confidence': float
        """
        self._load()

        results = self._model(frame, verbose=False)
        persons = []

        for r in results:
            for box in r.boxes:
                # Class 0 = person in COCO
                if int(box.cls[0]) != 0:
                    continue
                conf = float(box.conf[0])
                if conf < PERSON_CONFIDENCE_THRESHOLD:
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                persons.append({
                    "bbox": [int(x1), int(y1), int(x2), int(y2)],
                    "confidence": conf,
                })

        persons.sort(key=lambda p: p["confidence"], reverse=True)
        logger.info("Detected %d persons (YOLO)", len(persons))
        return persons
