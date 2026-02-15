"""Amazon Rekognition face comparison for target person identification."""

import logging
from typing import Dict, Optional

import cv2
import numpy as np
import boto3

from config import (
    AWS_REGION,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    REKOGNITION_SIMILARITY_THRESHOLD,
)

logger = logging.getLogger(__name__)

_client = None


def _get_client():
    global _client
    if _client is None:
        kwargs = {"region_name": AWS_REGION}
        if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
            kwargs["aws_access_key_id"] = AWS_ACCESS_KEY_ID
            kwargs["aws_secret_access_key"] = AWS_SECRET_ACCESS_KEY
        _client = boto3.client("rekognition", **kwargs)
    return _client


def compare_face(
    reference_bytes: bytes,
    face_crop: np.ndarray,
) -> Optional[Dict]:
    """Compare a face crop against the reference photo using Amazon Rekognition.

    Args:
        reference_bytes: JPEG bytes of the reference (target) photo.
        face_crop: BGR numpy array of the cropped face region from the frame.

    Returns:
        Dict with 'confidence' (float) and 'bbox' if match found, else None.
    """
    if face_crop.size == 0 or face_crop.shape[0] < 20 or face_crop.shape[1] < 20:
        return None

    try:
        # Encode crop to JPEG bytes
        success, encoded = cv2.imencode(".jpg", face_crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not success:
            return None
        target_bytes = encoded.tobytes()

        client = _get_client()
        response = client.compare_faces(
            SourceImage={"Bytes": reference_bytes},
            TargetImage={"Bytes": target_bytes},
            SimilarityThreshold=REKOGNITION_SIMILARITY_THRESHOLD,
        )

        matches = response.get("FaceMatches", [])
        if not matches:
            return None

        # Return best match
        best = max(matches, key=lambda m: m.get("Similarity", 0))
        confidence = best.get("Similarity", 0.0)

        face_detail = best.get("Face", {})
        bb = face_detail.get("BoundingBox", {})

        logger.info("Rekognition match: %.1f%% confidence", confidence)
        return {
            "confidence": confidence,
            "bounding_box": bb,
        }

    except Exception as e:
        if "InvalidParameterException" in type(e).__name__:
            logger.debug("No face detected in crop")
        else:
            logger.exception("Rekognition comparison failed")
        return None
