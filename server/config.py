"""Configuration constants and API keys for the drone control server."""

import os

# --- Server ---
WS_HOST = os.getenv("WS_HOST", "0.0.0.0")
WS_PORT = int(os.getenv("WS_PORT", "8765"))

# --- Google Maps ---
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")

# --- AWS Rekognition ---
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
REKOGNITION_SIMILARITY_THRESHOLD = float(os.getenv("REKOGNITION_SIMILARITY_THRESHOLD", "90.0"))

# --- SAM Model ---
SAM_MODEL_TYPE = os.getenv("SAM_MODEL_TYPE", "vit_b")
SAM_CHECKPOINT_PATH = os.getenv("SAM_CHECKPOINT_PATH", "models/sam_vit_b_01ec64.pth")
SAM_DEVICE = os.getenv("SAM_DEVICE", "cuda")  # "cuda" or "cpu"

# --- Navigation ---
CRUISE_ALTITUDE_M = float(os.getenv("CRUISE_ALTITUDE_M", "30.0"))
WAYPOINT_REACHED_RADIUS_M = float(os.getenv("WAYPOINT_REACHED_RADIUS_M", "10.0"))
IDENTIFICATION_RANGE_M = float(os.getenv("IDENTIFICATION_RANGE_M", "50.0"))
OBSTACLE_CENTER_THRESHOLD = 0.3  # fraction of frame center considered "in path"
OBSTACLE_MIN_AREA_FRACTION = 0.05  # minimum segment area to count as obstacle

# --- Frame Processing ---
FRAME_WIDTH = 1280
FRAME_HEIGHT = 720
