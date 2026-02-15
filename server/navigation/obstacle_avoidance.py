"""Obstacle detection stub.

Obstacle detection is disabled by default. This module provides
the interface so a proper detection backend can be dropped in later.
"""

import logging
from typing import Dict, Optional

import numpy as np

logger = logging.getLogger(__name__)


def detect_obstacles(frame: np.ndarray) -> Optional[Dict]:
    """Analyze frame for obstacles in the flight path.

    Currently a stub that always returns None (no obstacle detected).
    To implement, replace with a depth estimation or object detection model.

    Args:
        frame: BGR image (H, W, 3)

    Returns:
        None (obstacle detection not implemented)
    """
    return None
