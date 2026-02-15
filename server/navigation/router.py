"""Google Maps Directions API: GPS → street-level waypoints."""

import logging
from typing import Dict, List, Optional

import googlemaps

from config import GOOGLE_MAPS_API_KEY

logger = logging.getLogger(__name__)

_client: Optional[googlemaps.Client] = None


def _get_client() -> googlemaps.Client:
    global _client
    if _client is None:
        if not GOOGLE_MAPS_API_KEY:
            raise ValueError("GOOGLE_MAPS_API_KEY is not set")
        _client = googlemaps.Client(key=GOOGLE_MAPS_API_KEY)
    return _client


def get_route_waypoints(
    start_lat: float, start_lng: float,
    end_lat: float, end_lng: float,
    mode: str = "walking",
) -> List[Dict[str, float]]:
    """Get street-level waypoints from start to end using Google Directions API.

    Returns a list of {"lat": float, "lng": float} dicts representing the polyline.
    The drone follows these waypoints at altitude to stay above streets.
    """
    try:
        client = _get_client()
        directions = client.directions(
            origin=(start_lat, start_lng),
            destination=(end_lat, end_lng),
            mode=mode,
        )

        if not directions:
            logger.warning("No directions found from (%.4f,%.4f) to (%.4f,%.4f)",
                           start_lat, start_lng, end_lat, end_lng)
            return [{"lat": end_lat, "lng": end_lng}]

        # Extract polyline points from all steps
        waypoints = []
        for leg in directions[0].get("legs", []):
            for step in leg.get("steps", []):
                polyline = step.get("polyline", {}).get("points", "")
                decoded = _decode_polyline(polyline)
                waypoints.extend(decoded)

        # Deduplicate consecutive identical points
        filtered = []
        for wp in waypoints:
            if not filtered or (wp["lat"] != filtered[-1]["lat"] or wp["lng"] != filtered[-1]["lng"]):
                filtered.append(wp)

        logger.info("Route planned: %d waypoints", len(filtered))
        return filtered if filtered else [{"lat": end_lat, "lng": end_lng}]

    except Exception:
        logger.exception("Directions API failed")
        return [{"lat": end_lat, "lng": end_lng}]


def _decode_polyline(encoded: str) -> List[Dict[str, float]]:
    """Decode a Google Maps encoded polyline string into lat/lng points."""
    points = []
    idx = 0
    lat = 0
    lng = 0

    while idx < len(encoded):
        # Decode latitude
        shift = 0
        result = 0
        while True:
            b = ord(encoded[idx]) - 63
            idx += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lat += (~(result >> 1) if (result & 1) else (result >> 1))

        # Decode longitude
        shift = 0
        result = 0
        while True:
            b = ord(encoded[idx]) - 63
            idx += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lng += (~(result >> 1) if (result & 1) else (result >> 1))

        points.append({"lat": lat / 1e5, "lng": lng / 1e5})

    return points
