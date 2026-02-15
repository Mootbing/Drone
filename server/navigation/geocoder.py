"""Google Maps Geocoding: address → GPS coordinates."""

import logging
from typing import Optional, Tuple

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


def geocode_address(address: str) -> Optional[Tuple[float, float]]:
    """Geocode an address string to (lat, lng). Returns None on failure."""
    try:
        client = _get_client()
        results = client.geocode(address)
        if not results:
            logger.warning("No geocoding results for: %s", address)
            return None

        location = results[0]["geometry"]["location"]
        lat = location["lat"]
        lng = location["lng"]
        logger.info("Geocoded '%s' → (%.6f, %.6f)", address, lat, lng)
        return (lat, lng)
    except Exception:
        logger.exception("Geocoding failed for: %s", address)
        return None
