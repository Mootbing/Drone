"""Converts navigation decisions (GPS comparison) into phone movement commands."""

import math
import logging
from typing import Dict

from navigation.geo_utils import haversine_m

logger = logging.getLogger(__name__)


def compute_navigation_command(
    current_lat: float, current_lng: float,
    target_lat: float, target_lng: float,
    drone_heading: float = 0.0,
) -> Dict:
    """Compute a movement command to fly from current position toward target waypoint.

    Args:
        current_lat, current_lng: Current GPS position.
        target_lat, target_lng: Target waypoint GPS.
        drone_heading: Current drone heading in degrees (0=North). Defaults to 0.

    Returns a command dict with direction and intensity.
    """
    bearing = _compute_bearing(current_lat, current_lng, target_lat, target_lng)
    distance = haversine_m(current_lat, current_lng, target_lat, target_lng)

    # Compute relative bearing (how far off our heading the target is)
    relative_bearing = (bearing - drone_heading + 360) % 360

    # If target is significantly off-axis (>30° from forward), rotate first
    if 30 < relative_bearing < 330:
        # Determine shortest rotation direction
        if relative_bearing <= 180:
            direction = "rotate_cw"
            intensity = min(0.6, relative_bearing / 180)
        else:
            direction = "rotate_ccw"
            intensity = min(0.6, (360 - relative_bearing) / 180)
        logger.debug("Nav: bearing=%.1f° relative=%.1f° → rotate %s @ %.1f",
                     bearing, relative_bearing, direction, intensity)
    else:
        # Target is roughly ahead — move toward it
        direction = "forward"
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

