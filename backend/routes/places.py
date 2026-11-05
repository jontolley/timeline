import re
from urllib.parse import parse_qs, unquote, unquote_plus, urljoin, urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_auth

router = APIRouter(prefix="/api/places", dependencies=[Depends(require_auth)])

NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
_NOMINATIM_HEADERS = {"User-Agent": "personal-timeline/1.0", "Accept-Language": "en"}
_MAX_REDIRECTS = 5
# Apostrophes are allowed: Google leaves them unencoded in place names.
_URL_RE = re.compile(r"https?://[^\s<>\"]+")
# Google's place data blob carries the place's own pin as !3d<lat>!4d<lng>;
# the @lat,lng in the path is only where the map view was centred.
_GOOGLE_PIN_RE = re.compile(r"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)")
_GOOGLE_AT_RE = re.compile(r"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)")
_LATLNG_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")


class ResolveRequest(BaseModel):
    # A share-sheet payload: either a bare link or text with a link in it
    # (Google Maps sometimes shares "Place name\nhttps://maps.app.goo.gl/…").
    text: str


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def _is_google(url: str) -> bool:
    host = _host(url)
    if host in ("maps.app.goo.gl", "goo.gl"):
        return True
    # google.com, google.co.uk, …; only the /maps paths are place links.
    is_google_host = re.fullmatch(r"(www\.|maps\.)?google(\.[a-z]{2,3}){1,2}", host)
    return bool(is_google_host) and (host.startswith("maps.") or urlsplit(url).path.startswith("/maps"))


def _is_apple(url: str) -> bool:
    return _host(url) in ("maps.apple", "maps.apple.com")


def _is_short_link(url: str) -> bool:
    return _host(url) in ("maps.app.goo.gl", "goo.gl", "maps.apple")


def _source_for(url: str) -> str | None:
    if _is_google(url):
        return "google"
    if _is_apple(url):
        return "apple"
    return None


def _latlng(raw: str | None):
    m = _LATLNG_RE.match(raw or "")
    if not m:
        return None
    lat, lng = float(m.group(1)), float(m.group(2))
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def _clean(text: str | None) -> str | None:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text or None


def _parse_google(url: str) -> dict | None:
    parts = urlsplit(url)
    path = unquote(parts.path)
    query = parse_qs(parts.query)
    name = None
    coords = None

    m = re.search(r"/maps/place/([^/]+)", parts.path)
    if m:
        name = unquote_plus(m.group(1))
    pins = _GOOGLE_PIN_RE.findall(path)
    if pins:
        coords = (float(pins[-1][0]), float(pins[-1][1]))
    # ?q= / ?query= are either "lat,lng" or a search string (a place name).
    for key in ("q", "query"):
        val = (query.get(key) or [None])[0]
        if not val:
            continue
        if coords is None and _latlng(val):
            coords = _latlng(val)
        elif not name and not _latlng(val):
            name = val
    if coords is None:
        at = _GOOGLE_AT_RE.search(path)
        if at and name:
            coords = (float(at.group(1)), float(at.group(2)))
    # A dropped pin's "name" is just its coordinates in degrees-minutes-seconds
    # (48°16'34.6"N 116°32'57.9"W) — let reverse geocoding name it instead.
    if name and ("°" in name or _latlng(name)):
        name = None
    if coords is None:
        return None
    return {"name": _clean(name), "address": None, "lat": coords[0], "lng": coords[1]}


def _google_search_text(url: str) -> str | None:
    """The ?q= text of a Google link with no coordinates. The Google Maps iOS
    app shares links that resolve to maps.google.com?q=<name, address>&ftid=…
    — the place's pin isn't in the URL, only its name and street address."""
    query = parse_qs(urlsplit(url).query)
    for key in ("q", "query"):
        val = _clean((query.get(key) or [None])[0])
        if val and not _latlng(val):
            return val
    return None


def _parse_apple(url: str) -> dict | None:
    query = parse_qs(urlsplit(url).query)

    def first(*keys):
        for key in keys:
            val = (query.get(key) or [None])[0]
            if val:
                return val
        return None

    # Current links use coordinate/name/address; older ones ll/q/address.
    coords = _latlng(first("coordinate", "ll", "sll"))
    if coords is None:
        return None
    name = first("name", "q")
    if name and _latlng(name):
        name = None
    return {
        "name": _clean(name),
        "address": _clean(first("address")),
        "lat": coords[0],
        "lng": coords[1],
    }


async def _follow_short_link(client: httpx.AsyncClient, url: str) -> str:
    """Follow a share short link hop by hop, only ever requesting Google /
    Apple Maps hosts, until it lands on a URL that isn't a short link."""
    for _ in range(_MAX_REDIRECTS):
        if not _is_short_link(url):
            return url
        resp = await client.get(url, follow_redirects=False)
        location = resp.headers.get("location")
        if not resp.is_redirect or not location:
            break
        url = urljoin(url, location)
        if _source_for(url) is None:
            break
    print(f"[places] couldn't follow {url}", flush=True)
    raise HTTPException(status_code=422, detail="Couldn't open that map link.")


async def _reverse_geocode(client: httpx.AsyncClient, lat: float, lng: float) -> dict:
    try:
        resp = await client.get(
            NOMINATIM_REVERSE_URL,
            params={"lat": lat, "lon": lng, "format": "json"},
            headers=_NOMINATIM_HEADERS,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception:
        return {}


async def _geocode_search_text(client: httpx.AsyncClient, text: str) -> dict | None:
    """Place a "<name>, <street address>" search string. Nominatim rarely
    knows a business by name, so geocode the address part first and fall
    back to the whole string; the name is kept from the text either way."""
    name, _, address = text.partition(", ")
    if not address:
        name, address = None, text
    for q in dict.fromkeys((address, text)):
        try:
            resp = await client.get(
                NOMINATIM_SEARCH_URL,
                params={"q": q, "format": "json", "limit": 1},
                headers=_NOMINATIM_HEADERS,
            )
            resp.raise_for_status()
            hits = resp.json()
        except Exception:
            continue
        if hits:
            return {
                "name": _clean(name),
                "address": _clean(address),
                "lat": float(hits[0]["lat"]),
                "lng": float(hits[0]["lon"]),
            }
    return None


@router.post("/resolve")
async def resolve_place_link(req: ResolveRequest):
    """Turn a Google Maps or Apple Maps share link into a LocationDetail
    (name, address, lat/lng, plus the link itself so the event can open the
    real place). No API keys: the share links carry the place in the URL."""
    link = next((u.rstrip(".,)'") for u in _URL_RE.findall(req.text or "") if _source_for(u)), None)
    if not link:
        print(f"[places] no map link in {req.text[:200]!r}", flush=True)
        raise HTTPException(status_code=422, detail="That isn't a Google Maps or Apple Maps link.")
    source = _source_for(link)

    async with httpx.AsyncClient(timeout=10.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
        try:
            target = await _follow_short_link(client, link)
        except httpx.HTTPError:
            raise HTTPException(status_code=502, detail="Couldn't reach the map service.")
        place = _parse_google(target) if source == "google" else _parse_apple(target)
        if place is None and source == "google" and (search := _google_search_text(target)):
            place = await _geocode_search_text(client, search)
        if place is None:
            print(f"[places] no place in {link} -> {target}", flush=True)
            raise HTTPException(status_code=422, detail="Couldn't find a place in that link.")
        if not place["address"] or not place["name"]:
            data = await _reverse_geocode(client, place["lat"], place["lng"])
            place["address"] = place["address"] or _clean(data.get("display_name"))
            place["name"] = place["name"] or _clean(data.get("name")) or place["address"]

    return {**place, "source": source, "url": link}
