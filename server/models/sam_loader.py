"""SAM (Segment Anything Model) loading and inference wrapper."""

import logging
from typing import Dict, List, Optional

import cv2
import numpy as np

from config import SAM_MODEL_TYPE, SAM_CHECKPOINT_PATH, SAM_DEVICE

logger = logging.getLogger(__name__)


class SAMInference:
    """Wrapper around SAM model for mask generation."""

    def __init__(self):
        self._model = None
        self._mask_generator = None
        self._loaded = False

    def load(self):
        """Load the SAM model. Called once at server startup."""
        try:
            import torch
            from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

            logger.info("Loading SAM model: type=%s checkpoint=%s device=%s",
                        SAM_MODEL_TYPE, SAM_CHECKPOINT_PATH, SAM_DEVICE)

            device = SAM_DEVICE
            if device == "cuda" and not torch.cuda.is_available():
                logger.warning("CUDA not available, falling back to CPU")
                device = "cpu"

            sam = sam_model_registry[SAM_MODEL_TYPE](checkpoint=SAM_CHECKPOINT_PATH)
            sam.to(device=device)

            self._model = sam
            self._mask_generator = SamAutomaticMaskGenerator(
                model=sam,
                points_per_side=16,          # fewer points = faster
                pred_iou_thresh=0.86,
                stability_score_thresh=0.92,
                min_mask_region_area=500,
            )
            self._loaded = True
            logger.info("SAM model loaded successfully")

        except FileNotFoundError:
            logger.error("SAM checkpoint not found at %s. "
                         "Download from https://github.com/facebookresearch/segment-anything#model-checkpoints",
                         SAM_CHECKPOINT_PATH)
            self._loaded = False
        except Exception:
            logger.exception("Failed to load SAM model")
            self._loaded = False

    def generate_masks(self, image: np.ndarray) -> List[Dict]:
        """Generate segmentation masks for an image.

        Args:
            image: BGR image array (H, W, 3)

        Returns:
            List of mask dicts, each containing:
              - 'segmentation': bool array (H, W)
              - 'area': int (pixel count)
              - 'bbox': [x, y, w, h]
              - 'predicted_iou': float
              - 'stability_score': float
        """
        if not self._loaded or self._mask_generator is None:
            logger.warning("SAM not loaded, returning empty masks")
            return []

        try:
            # SAM expects RGB
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            masks = self._mask_generator.generate(rgb)
            # Sort by area descending
            masks.sort(key=lambda x: x["area"], reverse=True)
            return masks
        except Exception:
            logger.exception("SAM inference failed")
            return []
