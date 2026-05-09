"""
weather.py — Open-Meteo free tier integration with 10-minute caching.
Applies FUEL_PENALTY_MULTIPLIER = 1.30 if wind > 25 km/h or precipitation > 1 mm/h.
"""
import time
import httpx
from typing import Dict, Any, Tuple

FUEL_PENALTY_MULTIPLIER = 1.30
_CACHE_TTL_SECONDS = 600  # 10 minutes

# Cache: key = (rounded_lat, rounded_lng) → (timestamp, data)
_weather_cache: Dict[Tuple[float, float], Tuple[float, Dict[str, Any]]] = {}

# Representative centre of the Strait of Hormuz
HORMUZ_LAT = 26.5
HORMUZ_LNG = 56.5


async def fetch_weather(lat: float = HORMUZ_LAT, lng: float = HORMUZ_LNG) -> Dict[str, Any]:
    """
    Fetch current weather from Open-Meteo for the given coordinates.
    Results are cached for 10 minutes per (rounded lat, rounded lng) pair.
    Returns a dict with 'wind_speed_kmh', 'precipitation_mmh', 'penalty_active'.
    """
    cache_key = (round(lat, 1), round(lng, 1))
    now = time.monotonic()

    # Check cache
    if cache_key in _weather_cache:
        cached_at, data = _weather_cache[cache_key]
        if now - cached_at < _CACHE_TTL_SECONDS:
            return data

    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lng,
        "current": "wind_speed_10m,precipitation",
        "wind_speed_unit": "kmh",
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            raw = resp.json()

        current = raw.get("current", {})
        wind_speed = float(current.get("wind_speed_10m", 0.0))
        precipitation = float(current.get("precipitation", 0.0))
    except Exception:
        # On any error, return a safe default (no penalty)
        wind_speed = 0.0
        precipitation = 0.0

    penalty_active = wind_speed > 25.0 or precipitation > 1.0

    data = {
        "wind_speed_kmh": wind_speed,
        "precipitation_mmh": precipitation,
        "penalty_active": penalty_active,
        "fuel_multiplier": FUEL_PENALTY_MULTIPLIER if penalty_active else 1.0,
    }

    _weather_cache[cache_key] = (now, data)
    return data


def apply_fuel_penalty(base_burn: float, weather: Dict[str, Any]) -> float:
    """Multiply base fuel burn by the weather penalty multiplier if active."""
    return base_burn * weather.get("fuel_multiplier", 1.0)
