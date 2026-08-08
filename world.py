"""
the weather outside the window

Open-Meteo, no key, no account. A cat at a window has an opinion about rain and
a strong one about wind. The sky over the actual house is free and nobody expects
a memecoin cat to be correlated with it, which is exactly why it lands.
"""

import os
import time
import logging

import requests

log = logging.getLogger("world")

LAT = float(os.getenv("CARK_LAT", "36.17"))
LON = float(os.getenv("CARK_LON", "-115.14"))     # north las vegas
CACHE_MIN = int(os.getenv("CARK_WEATHER_CACHE_MIN", "20"))

URL = ("https://api.open-meteo.com/v1/forecast"
       "?latitude={lat}&longitude={lon}"
       "&current=temperature_2m,precipitation,cloud_cover,wind_speed_10m,"
       "weather_code,is_day&temperature_unit=fahrenheit&wind_speed_unit=mph")

# WMO codes, collapsed to what a cat can tell apart through glass
def _sky(code, clouds, precip, wind, temp):
    if code >= 95:
        return "storm", "there is a storm and i do not accept it"
    if code >= 71:
        return "snow", "the sky is coming down in pieces"
    if code >= 51 or precip > 0:
        return "rain", "its raining. the window is wet and the outside is cancelled"
    if wind > 22:
        return "wind", "everything outside is moving and none of it is alive"
    if temp >= 100:
        return "baking", "the glass is too hot to lie against and thats an insult"
    if temp <= 45:
        return "cold", "its cold out. i can tell from here without going"
    if clouds < 25:
        return "clear", "the sun is doing the thing on the floor"
    if clouds > 75:
        return "grey", "the sky is one colour and its the boring one"
    return "fine", "its ordinary out. nothing is happening in the sky"


_cache = {"at": 0, "data": None}


def weather(force=False):
    """Current conditions, cached. None if it cannot be reached."""
    if not force and _cache["data"] and time.time() - _cache["at"] < CACHE_MIN * 60:
        return _cache["data"]
    try:
        r = requests.get(URL.format(lat=LAT, lon=LON), timeout=10)
        r.raise_for_status()
        cur = (r.json() or {}).get("current") or {}
    except Exception as e:
        log.warning("weather unavailable: %s", e)
        return _cache["data"]

    temp = float(cur.get("temperature_2m") or 0)
    clouds = float(cur.get("cloud_cover") or 0)
    precip = float(cur.get("precipitation") or 0)
    wind = float(cur.get("wind_speed_10m") or 0)
    code = int(cur.get("weather_code") or 0)

    kind, line = _sky(code, clouds, precip, wind, temp)
    data = {
        "kind": kind, "line": line,
        "temp": round(temp), "clouds": round(clouds),
        "precip": precip, "wind": round(wind),
        "is_day": bool(cur.get("is_day", 1)),
    }
    _cache.update(at=time.time(), data=data)
    return data


def weather_effect(w):
    """What the sky does to a cat. Returns need nudges and a place preference."""
    if not w:
        return {}, None
    k = w["kind"]
    if k == "storm":
        return {"rest": -0.12, "attention": 0.15}, "mind"     # hides
    if k == "rain":
        return {"stimulation": -0.08}, "window"               # watches it
    if k == "wind":
        return {"stimulation": 0.12}, "window"                # everything moves
    if k == "baking":
        return {"rest": 0.15, "stimulation": -0.05}, "mind"   # flat out
    if k == "cold":
        return {"rest": 0.08}, "window"
    if k == "clear" and w.get("is_day"):
        return {"rest": 0.1}, "window"                        # the sun patch
    return {}, None
