"""Configuration constants and API keys for the drone control server."""

import os
from dotenv import load_dotenv

load_dotenv()

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

# --- Person Detection (YOLOv8) ---
PERSON_CONFIDENCE_THRESHOLD = float(os.getenv("PERSON_CONFIDENCE_THRESHOLD", "0.4"))

# --- Navigation ---
WAYPOINT_REACHED_RADIUS_M = float(os.getenv("WAYPOINT_REACHED_RADIUS_M", "10.0"))
IDENTIFICATION_RANGE_M = float(os.getenv("IDENTIFICATION_RANGE_M", "50.0"))
