"""Converts navigation decisions (GPS comparison) into phone movement commands."""

import math
import logging
from typing import Dict

logger = logging.getLogger(__name__)


def compute_navigation_command(
    current_lat: float, current_lng: float,
    target_lat: float, target_lng: float,
) -> Dict:
    """Compute a movement command to fly from current position toward target waypoint.

    Returns a command dict with direction and intensity.
    """
    bearing = _compute_bearing(current_lat, current_lng, target_lat, target_lng)
    distance = _haversine_m(current_lat, current_lng, target_lat, target_lng)

    # Map bearing to drone commands
    # Bearing: 0=N, 90=E, 180=S, 270=W
    # We assume the drone faces north by default; real implementation would
    # account for drone heading from compass/IMU data.

    # Quantize bearing to primary direction
    direction = _bearing_to_direction(bearing)

    # Intensity based on distance (closer = gentler)
    if distance > 100:
        intensity = 0.8
    elif distance > 50:
        intensity = 0.6
    elif distance > 20:
        intensity = 0.4
    else:
        intensity = 0.3

    logger.debug("Nav: bearing=%.1f° dist=%.1fm → %s @ %.1f",
                 bearing, distance, direction, intensity)

    return {
        "direction": direction,
        "intensity": intensity,
        "duration_ms": 500,
    }


def _compute_bearing(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Compute bearing in degrees from point 1 to point 2 (0-360, 0=North)."""
    lat1_r = math.radians(lat1)
    lat2_r = math.radians(lat2)
    dlng_r = math.radians(lng2 - lng1)

    x = math.sin(dlng_r) * math.cos(lat2_r)
    y = (math.cos(lat1_r) * math.sin(lat2_r) -
         math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlng_r))

    bearing = math.degrees(math.atan2(x, y))
    return (bearing + 360) % 360


def _bearing_to_direction(bearing: float) -> str:
    """Map a bearing angle to a drone direction command.

    We decompose into primary axis commands. For diagonal bearings,
    we pick the dominant axis.
    """
    # Normalize to 0-360
    bearing = bearing % 360

    if 337.5 <= bearing or bearing < 22.5:
        return "forward"    # North
    elif 22.5 <= bearing < 67.5:
        return "forward"    # NE → forward (+ rotate right would be ideal)
    elif 67.5 <= bearing < 112.5:
        return "right"      # East
    elif 112.5 <= bearing < 157.5:
        return "right"      # SE → right
    elif 157.5 <= bearing < 202.5:
        return "back"       # South
    elif 202.5 <= bearing < 247.5:
        return "left"       # SW → left
    elif 247.5 <= bearing < 292.5:
        return "left"       # West
    else:
        return "forward"    # NW → forward


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in meters."""
    R = 6_371_000
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
