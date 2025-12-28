#!/usr/bin/env python3
"""
Surface Analyzer for Cycling Routes
====================================
Analyzes GPX tracks and classifies road surface types using OpenStreetMap data.

This script:
1. Reads GPX files from the data/gpx/ directory
2. Queries Overpass API once per file (bbox query - efficient!)
3. Matches track points to nearby OSM ways
4. Classifies segments as: asphalt, unpaved, or trail
5. Updates routes.json with surface data
6. Optionally generates HTML maps for visualization

Usage:
    python surface_analyzer.py [options]

Options:
    --force       Reprocess all files, ignoring cache
    --verbose     Print detailed progress information
    --dry-run     Analyze but do not update routes.json
    --skip-api    Skip Overpass API calls (fast mode, marks all as asphalt)
    --map         Generate HTML map for each route

Requirements:
    pip install -r requirements.txt
"""

import argparse
import hashlib
import json
import os
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from math import atan2, cos, radians, sin, sqrt
from pathlib import Path
from typing import Optional

try:
    import gpxpy
except ImportError:
    print("Error: gpxpy not found. Install with: pip install gpxpy")
    sys.exit(1)

try:
    import requests
except ImportError:
    print("Error: requests not found. Install with: pip install requests")
    sys.exit(1)


# =============================================================================
# CONFIGURATION
# =============================================================================

# Overpass API servers (in order of preference)
OVERPASS_SERVERS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# Maximum distance (meters) to associate a point with a way
MAX_DISTANCE_TO_WAY = 30

# Minimum distance (meters) between sampled points for analysis
SAMPLING_DISTANCE = 50

# Cache file name
CACHE_FILE = "surface_cache.json"


# =============================================================================
# SURFACE CLASSIFICATION
# =============================================================================

# OSM tags indicating paved surfaces
PAVED_SURFACES = {
    "asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes",
    "paving_stones", "sett", "cobblestone", "metal", "wood", "tartan"
}

# OSM tags indicating unpaved surfaces (gravel-like)
GRAVEL_SURFACES = {
    "gravel", "fine_gravel", "compacted", "pebblestone", "rock"
}

# OSM tags indicating dirt/earth surfaces
DIRT_SURFACES = {
    "dirt", "earth", "ground", "mud", "unpaved"
}

# OSM tags indicating trail surfaces
TRAIL_SURFACES = {
    "grass", "grass_paver", "sand", "woodchips", "stepping_stones"
}

# Highway types typically paved
PAVED_HIGHWAYS = {
    "motorway", "trunk", "primary", "secondary", "tertiary",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
    "residential", "living_street", "service", "unclassified", "cycleway"
}

# Highway types typically unpaved
UNPAVED_HIGHWAYS = {"track"}

# Highway types typically trails
TRAIL_HIGHWAYS = {"path", "footway", "bridleway", "steps"}


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class SegmentInfo:
    """Information about a route segment"""
    lat_from: float
    lon_from: float
    lat_to: float
    lon_to: float
    distance_m: float
    surface_raw: str           # Raw OSM surface tag
    surface_category: str      # Granular: asphalt, gravel, dirt, trail, unknown
    surface_type: str          # For routes.json: asphalt, unpaved, trail
    highway_type: str
    road_name: str
    osm_way_id: Optional[int]
    point_index: int


# Category to routes.json type mapping
CATEGORY_TO_TYPE = {
    "asphalt": "asphalt",
    "gravel": "unpaved",
    "dirt": "unpaved",
    "trail": "trail",
    "unknown": "asphalt"  # Default to asphalt if unknown
}

# Colors for HTML map (gravel and dirt are similar brown tones)
CATEGORY_COLORS = {
    "asphalt": "#333333",      # Dark gray
    "gravel": "#B8860B",       # Dark goldenrod (light brown)
    "dirt": "#8B4513",         # Saddle brown (dark brown)
    "trail": "#228B22",        # Forest green
    "unknown": "#FF4444",      # Red
}


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters between two GPS points using Haversine formula"""
    R = 6371000  # Earth's radius in meters
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lon2 - lon1)
    a = sin(dphi/2)**2 + cos(phi1)*cos(phi2)*sin(dlambda/2)**2
    return 2 * R * atan2(sqrt(a), sqrt(1-a))


def point_to_segment_distance(px: float, py: float,
                               x1: float, y1: float,
                               x2: float, y2: float) -> float:
    """Calculate minimum distance between a point and a line segment"""
    dx = x2 - x1
    dy = y2 - y1

    if dx == 0 and dy == 0:
        return haversine(px, py, x1, y1)

    t = max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    proj_x = x1 + t * dx
    proj_y = y1 + t * dy

    return haversine(px, py, proj_x, proj_y)


# =============================================================================
# GPX LOADING
# =============================================================================

def load_gpx(filepath: str) -> tuple[list[dict], str]:
    """
    Load GPX file and return track points with elevation.
    Returns: (points_list, track_name)
    """
    with open(filepath, 'r', encoding='utf-8') as f:
        gpx = gpxpy.parse(f)

    points = []
    name = Path(filepath).stem

    # Extract name from GPX
    if gpx.tracks and gpx.tracks[0].name:
        name = gpx.tracks[0].name
    elif gpx.name:
        name = gpx.name

    # Extract points from tracks
    for track in gpx.tracks:
        for segment in track.segments:
            for point in segment.points:
                points.append({
                    'lat': point.latitude,
                    'lon': point.longitude,
                    'ele': point.elevation or 0
                })

    # Try routes if no tracks
    if not points:
        for route in gpx.routes:
            for point in route.points:
                points.append({
                    'lat': point.latitude,
                    'lon': point.longitude,
                    'ele': point.elevation or 0
                })

    # Try waypoints if no routes
    if not points:
        for waypoint in gpx.waypoints:
            points.append({
                'lat': waypoint.latitude,
                'lon': waypoint.longitude,
                'ele': waypoint.elevation or 0
            })

    return points, name


def sample_points(points: list[dict], min_distance_m: float = SAMPLING_DISTANCE) -> list[dict]:
    """Sample points maintaining at least min_distance_m meters between them"""
    if not points:
        return []

    sampled = [{'point': points[0], 'index': 0}]

    for i, p in enumerate(points[1:], 1):
        last = sampled[-1]['point']
        dist = haversine(last['lat'], last['lon'], p['lat'], p['lon'])
        if dist >= min_distance_m:
            sampled.append({'point': p, 'index': i})

    # Always include the last point
    if sampled[-1]['index'] != len(points) - 1:
        sampled.append({'point': points[-1], 'index': len(points) - 1})

    return sampled


# =============================================================================
# OVERPASS API
# =============================================================================

def query_overpass_bbox(points: list[dict], timeout: int = 120, verbose: bool = False) -> list[dict]:
    """
    Query Overpass API for all ways in the bounding box of the track.
    This is much more efficient than querying for each point individually.
    Returns a list of OSM ways with geometry.
    """
    if not points:
        return []

    # Calculate bounding box
    min_lat = min(p['lat'] for p in points)
    max_lat = max(p['lat'] for p in points)
    min_lon = min(p['lon'] for p in points)
    max_lon = max(p['lon'] for p in points)

    # Expand bbox by ~100m
    delta = 0.001
    bbox = f"{min_lat - delta},{min_lon - delta},{max_lat + delta},{max_lon + delta}"

    # Overpass query - get highways with geometry
    query = f"""
    [out:json][timeout:{timeout}];
    (
      way["highway"]({bbox});
    );
    out body geom;
    """

    # Try each server
    for server_url in OVERPASS_SERVERS:
        try:
            server_name = server_url.split('/')[2]
            if verbose:
                print(f"    Querying {server_name}...", end=" ", flush=True)

            response = requests.post(
                server_url,
                data={"data": query},
                timeout=timeout,
                headers={"User-Agent": "CyclingRoutesAnalyzer/2.0"}
            )
            response.raise_for_status()
            data = response.json()
            ways = data.get("elements", [])

            if verbose:
                print(f"OK ({len(ways)} ways)")

            return ways

        except requests.exceptions.Timeout:
            if verbose:
                print("timeout")
        except requests.exceptions.RequestException as e:
            if verbose:
                print(f"error: {e}")

        time.sleep(1)  # Pause between attempts

    print("    WARNING: All Overpass servers failed")
    return []


# =============================================================================
# SURFACE CLASSIFICATION
# =============================================================================

def find_nearest_way(lat: float, lon: float, ways: list[dict],
                     max_distance: float = MAX_DISTANCE_TO_WAY) -> tuple[Optional[dict], float]:
    """Find the nearest way to a point"""
    nearest_way = None
    min_dist = float('inf')

    for way in ways:
        if "geometry" not in way:
            continue

        geom = way["geometry"]
        for i in range(len(geom) - 1):
            dist = point_to_segment_distance(
                lat, lon,
                geom[i]["lat"], geom[i]["lon"],
                geom[i+1]["lat"], geom[i+1]["lon"]
            )
            if dist < min_dist:
                min_dist = dist
                nearest_way = way

    if min_dist <= max_distance:
        return nearest_way, min_dist
    return None, min_dist


def classify_surface(way: Optional[dict]) -> tuple[str, str, str]:
    """
    Classify the surface of a way based on OSM tags.
    Returns: (raw_surface, category, type_for_routes_json)
    """
    if not way:
        return "unknown", "unknown", "asphalt"

    tags = way.get("tags", {})
    surface = tags.get("surface", "").lower()
    highway = tags.get("highway", "").lower()
    tracktype = tags.get("tracktype", "").lower()
    sac_scale = tags.get("sac_scale", "")

    # Check sac_scale first (indicates hiking trail)
    if sac_scale:
        return f"sac_scale:{sac_scale}", "trail", "trail"

    # Check surface tag if present (most reliable)
    if surface:
        if surface in PAVED_SURFACES:
            return surface, "asphalt", "asphalt"
        elif surface in GRAVEL_SURFACES:
            return surface, "gravel", "unpaved"
        elif surface in DIRT_SURFACES:
            return surface, "dirt", "unpaved"
        elif surface in TRAIL_SURFACES:
            return surface, "trail", "trail"
        else:
            # Unknown surface tag, try to guess
            return surface, "unknown", "asphalt"

    # No surface tag - use highway type as heuristic
    if highway in PAVED_HIGHWAYS:
        return f"{highway} (presumed paved)", "asphalt", "asphalt"
    elif highway in UNPAVED_HIGHWAYS:
        # Check tracktype for more detail
        if tracktype == "grade1":
            return f"{highway}/grade1", "asphalt", "asphalt"
        elif tracktype == "grade2":
            return f"{highway}/grade2", "gravel", "unpaved"
        elif tracktype in {"grade3", "grade4", "grade5"}:
            return f"{highway}/{tracktype}", "dirt", "unpaved"
        return f"{highway} (presumed unpaved)", "gravel", "unpaved"
    elif highway in TRAIL_HIGHWAYS:
        return f"{highway} (presumed trail)", "trail", "trail"

    return "unknown", "unknown", "asphalt"


# =============================================================================
# ANALYSIS
# =============================================================================

def analyze_route_surfaces(points: list[dict], ways: list[dict],
                           verbose: bool = False) -> list[SegmentInfo]:
    """Analyze surface types for each segment of the route"""
    segments = []

    for i in range(len(points) - 1):
        p1, p2 = points[i], points[i+1]

        # Use midpoint to find nearest way
        mid_lat = (p1['lat'] + p2['lat']) / 2
        mid_lon = (p1['lon'] + p2['lon']) / 2

        segment_dist = haversine(p1['lat'], p1['lon'], p2['lat'], p2['lon'])
        way, dist_to_way = find_nearest_way(mid_lat, mid_lon, ways)

        surface_raw, category, surface_type = classify_surface(way)

        segments.append(SegmentInfo(
            lat_from=p1['lat'],
            lon_from=p1['lon'],
            lat_to=p2['lat'],
            lon_to=p2['lon'],
            distance_m=segment_dist,
            surface_raw=surface_raw,
            surface_category=category,
            surface_type=surface_type,
            highway_type=way.get("tags", {}).get("highway", "?") if way else "?",
            road_name=way.get("tags", {}).get("name", "") if way else "",
            osm_way_id=way.get("id") if way else None,
            point_index=i
        ))

    return segments


def build_route_segments(segments: list[SegmentInfo]) -> list[dict]:
    """Build simplified segments list for routes.json (consecutive same-type segments merged)"""
    if not segments:
        return []

    result = []
    current_type = segments[0].surface_type
    current_start = 0

    for i, seg in enumerate(segments[1:], 1):
        if seg.surface_type != current_type:
            result.append({
                'da_indice': current_start,
                'a_indice': seg.point_index,
                'tipo_fondo': current_type
            })
            current_type = seg.surface_type
            current_start = seg.point_index

    # Add final segment
    result.append({
        'da_indice': current_start,
        'a_indice': len(segments),
        'tipo_fondo': current_type
    })

    return result


def calculate_stats(segments: list[SegmentInfo]) -> dict:
    """Calculate surface statistics from detailed segments"""
    total_dist = sum(s.distance_m for s in segments)
    if total_dist == 0:
        return {'asfalto_percent': 100, 'sterrato_percent': 0, 'sentiero_percent': 0}

    type_distances = defaultdict(float)
    for seg in segments:
        type_distances[seg.surface_type] += seg.distance_m

    return {
        'asfalto_percent': round(type_distances.get('asphalt', 0) / total_dist * 100),
        'sterrato_percent': round(type_distances.get('unpaved', 0) / total_dist * 100),
        'sentiero_percent': round(type_distances.get('trail', 0) / total_dist * 100)
    }


def calculate_distance(points: list[dict]) -> float:
    """Calculate total distance in km"""
    total = 0
    for i in range(1, len(points)):
        total += haversine(
            points[i-1]['lat'], points[i-1]['lon'],
            points[i]['lat'], points[i]['lon']
        )
    return round(total / 1000, 1)


def calculate_elevation_gain(points: list[dict]) -> int:
    """Calculate positive elevation gain in meters"""
    gain = 0
    for i in range(1, len(points)):
        diff = points[i]['ele'] - points[i-1]['ele']
        if diff > 0:
            gain += diff
    return round(gain)


# =============================================================================
# HTML MAP GENERATION
# =============================================================================

def generate_html_map(segments: list[SegmentInfo], output_path: str, gpx_name: str = "Route"):
    """Generate an interactive HTML map with Leaflet"""
    if not segments:
        print("    No segments to visualize")
        return

    # Calculate map center
    all_lats = [s.lat_from for s in segments] + [segments[-1].lat_to]
    all_lons = [s.lon_from for s in segments] + [segments[-1].lon_to]
    center_lat = sum(all_lats) / len(all_lats)
    center_lon = sum(all_lons) / len(all_lons)

    # Calculate statistics
    total_dist = sum(s.distance_m for s in segments)
    cat_distances = defaultdict(float)
    for s in segments:
        cat_distances[s.surface_category] += s.distance_m

    # Prepare segment data for JavaScript
    segments_data = []
    for s in segments:
        segments_data.append({
            "coords": [[s.lat_from, s.lon_from], [s.lat_to, s.lon_to]],
            "category": s.surface_category,
            "surface": s.surface_raw,
            "highway": s.highway_type,
            "name": s.road_name,
            "distance": round(s.distance_m, 1)
        })

    # Statistics HTML
    category_labels = {
        "asphalt": "Asfalto",
        "gravel": "Sterrato",
        "dirt": "Terra",
        "trail": "Sentiero",
        "unknown": "Sconosciuto"
    }

    stats_html = ""
    for cat in ["asphalt", "gravel", "dirt", "trail", "unknown"]:
        dist = cat_distances.get(cat, 0)
        if dist > 0:
            pct = (dist / total_dist) * 100
            stats_html += f'<div class="stat-item stat-{cat}"><span class="stat-label">{category_labels[cat]}:</span> <span class="stat-value">{dist/1000:.2f} km ({pct:.1f}%)</span></div>'

    html_content = f'''<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{gpx_name} - Analisi Superficie</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }}
        #map {{ width: 100%; height: 100vh; }}
        .legend {{
            position: absolute; bottom: 30px; left: 10px;
            background: white; padding: 15px; border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 1000; max-width: 280px;
        }}
        .legend h3 {{ margin-bottom: 10px; font-size: 14px; color: #333; }}
        .legend-item {{ display: flex; align-items: center; margin: 8px 0; font-size: 13px; }}
        .legend-line {{ width: 40px; height: 4px; margin-right: 10px; border-radius: 2px; }}
        .legend-line.asphalt {{ background: #333333; }}
        .legend-line.gravel {{ background: #B8860B; }}
        .legend-line.dirt {{ background: #8B4513; }}
        .legend-line.trail {{ background: #228B22; }}
        .legend-line.unknown {{ background: #FF4444; }}
        .stats {{
            position: absolute; top: 10px; right: 10px;
            background: white; padding: 15px; border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 1000; min-width: 200px;
        }}
        .stats h3 {{ margin-bottom: 10px; font-size: 14px; color: #333; border-bottom: 1px solid #eee; padding-bottom: 8px; }}
        .stat-item {{
            display: flex; justify-content: space-between; margin: 6px 0;
            font-size: 12px; padding-left: 8px; border-left: 3px solid #ccc;
        }}
        .stat-asphalt {{ border-left-color: #333333; }}
        .stat-gravel {{ border-left-color: #B8860B; }}
        .stat-dirt {{ border-left-color: #8B4513; }}
        .stat-trail {{ border-left-color: #228B22; }}
        .stat-unknown {{ border-left-color: #FF4444; }}
        .stat-label {{ color: #666; }}
        .stat-value {{ font-weight: 500; color: #333; }}
        .total {{ margin-top: 10px; padding-top: 8px; border-top: 1px solid #eee; font-weight: bold; }}
        .info-popup {{ font-size: 13px; line-height: 1.5; }}
        .info-popup strong {{ color: #333; }}
    </style>
</head>
<body>
    <div id="map"></div>

    <div class="legend">
        <h3>Legenda Superfici</h3>
        <div class="legend-item"><div class="legend-line asphalt"></div><span>Asfalto</span></div>
        <div class="legend-item"><div class="legend-line gravel"></div><span>Sterrato (ghiaia)</span></div>
        <div class="legend-item"><div class="legend-line dirt"></div><span>Terra</span></div>
        <div class="legend-item"><div class="legend-line trail"></div><span>Sentiero</span></div>
        <div class="legend-item"><div class="legend-line unknown"></div><span>Sconosciuto</span></div>
    </div>

    <div class="stats">
        <h3>{gpx_name}</h3>
        {stats_html}
        <div class="stat-item total"><span>TOTALE:</span><span>{total_dist/1000:.2f} km</span></div>
    </div>

    <script>
        const map = L.map('map').setView([{center_lat}, {center_lon}], 13);
        L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
            attribution: '&copy; OpenStreetMap contributors'
        }}).addTo(map);

        const segments = {json.dumps(segments_data)};
        const colors = {{
            asphalt: '#333333',
            gravel: '#B8860B',
            dirt: '#8B4513',
            trail: '#228B22',
            unknown: '#FF4444'
        }};

        const segmentGroup = L.featureGroup();

        segments.forEach(seg => {{
            const color = colors[seg.category] || colors.unknown;
            const isDashed = ['gravel', 'dirt'].includes(seg.category);

            const line = L.polyline(seg.coords, {{
                color: color,
                weight: 5,
                opacity: 0.9,
                dashArray: isDashed ? '10, 8' : null
            }});
            line.bindPopup(`
                <div class="info-popup">
                    <strong>${{seg.name || 'Senza nome'}}</strong><br>
                    Tipo: ${{seg.highway}}<br>
                    Superficie: ${{seg.surface}}<br>
                    Distanza: ${{seg.distance}} m
                </div>
            `);
            segmentGroup.addLayer(line);
        }});

        segmentGroup.addTo(map);
        map.fitBounds(segmentGroup.getBounds(), {{ padding: [50, 50] }});

        if (segments.length > 0) {{
            const first = segments[0].coords[0];
            const last = segments[segments.length - 1].coords[1];
            L.marker(first, {{
                icon: L.divIcon({{
                    html: '<div style="background:#22c55e;color:white;padding:4px 8px;border-radius:4px;font-weight:bold;font-size:12px;">START</div>',
                    iconSize: [50, 20], iconAnchor: [25, 10]
                }})
            }}).addTo(map);
            L.marker(last, {{
                icon: L.divIcon({{
                    html: '<div style="background:#ef4444;color:white;padding:4px 8px;border-radius:4px;font-weight:bold;font-size:12px;">END</div>',
                    iconSize: [40, 20], iconAnchor: [20, 10]
                }})
            }}).addTo(map);
        }}
    </script>
</body>
</html>'''

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_content)

    print(f"    Map generated: {output_path}")


# =============================================================================
# CACHING
# =============================================================================

def get_file_hash(file_path: str) -> str:
    """Get MD5 hash of a file for caching purposes"""
    with open(file_path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def load_cache(cache_path: Path) -> dict:
    """Load the analysis cache"""
    if cache_path.exists():
        try:
            with open(cache_path, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_cache(cache_path: Path, cache: dict):
    """Save the analysis cache"""
    with open(cache_path, 'w') as f:
        json.dump(cache, f, indent=2)


# =============================================================================
# ROUTE ANALYSIS
# =============================================================================

def analyze_route(gpx_path: str, cache: dict, verbose: bool = False,
                  skip_api: bool = False, generate_map: bool = False) -> Optional[dict]:
    """Analyze a single GPX file and return route data"""
    file_hash = get_file_hash(gpx_path)
    file_name = os.path.basename(gpx_path)

    # Check cache
    if not skip_api and file_name in cache and cache[file_name].get('hash') == file_hash:
        if verbose:
            print(f"  Using cached data for {file_name}")
        return cache[file_name]['data']

    if verbose:
        print(f"  Analyzing {file_name}...")

    # Load GPX
    points, name = load_gpx(gpx_path)
    if not points:
        print(f"  Warning: No points found in {file_name}")
        return None

    if verbose:
        print(f"    {len(points)} points loaded")

    # Calculate basic stats
    distance = calculate_distance(points)
    elevation = calculate_elevation_gain(points)

    if skip_api:
        # Skip API mode: mark entire route as asphalt
        if verbose:
            print(f"    Skipping API calls (--skip-api mode)")
        segments_for_json = [{
            'da_indice': 0,
            'a_indice': len(points) - 1,
            'tipo_fondo': 'asphalt'
        }]
        stats = {'asfalto_percent': 100, 'sterrato_percent': 0, 'sentiero_percent': 0}
        detailed_segments = None
    else:
        # Query Overpass for all ways in the bounding box
        if verbose:
            print(f"    Querying Overpass API (bbox)...")
        ways = query_overpass_bbox(points, verbose=verbose)

        if not ways:
            print(f"    Warning: No OSM data available for {file_name}")
            segments_for_json = [{
                'da_indice': 0,
                'a_indice': len(points) - 1,
                'tipo_fondo': 'asphalt'
            }]
            stats = {'asfalto_percent': 100, 'sterrato_percent': 0, 'sentiero_percent': 0}
            detailed_segments = None
        else:
            # Analyze each segment
            if verbose:
                print(f"    Analyzing {len(points)-1} segments...")

            detailed_segments = analyze_route_surfaces(points, ways, verbose)

            # Build simplified segments for routes.json
            segments_for_json = build_route_segments(detailed_segments)

            # Calculate statistics
            stats = calculate_stats(detailed_segments)

    # Generate HTML map if requested (needs detailed_segments)
    if generate_map and detailed_segments:
        map_path = Path(gpx_path).with_suffix('.html')
        generate_html_map(detailed_segments, str(map_path), name)
    elif generate_map:
        if verbose:
            print(f"    Skipping map generation (no detailed surface data)")

    # Build route data
    route_data = {
        'id': Path(gpx_path).stem,
        'nome': {'it': name, 'en': name},
        'file_gpx': file_name,
        'colore': None,
        'distanza_km': distance,
        'dislivello_positivo': elevation,
        'stats_fondo': stats,
        'segmenti': segments_for_json,
        'info_extra': {
            'difficolta': 'media' if stats['sentiero_percent'] > 0 else ('facile' if stats['sterrato_percent'] == 0 else 'media'),
            'nota': {'it': '', 'en': ''}
        }
    }

    # Update cache
    cache[file_name] = {
        'hash': file_hash,
        'data': route_data,
        'analyzed': datetime.now().isoformat()
    }

    return route_data


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Analyze GPX routes for surface types using OpenStreetMap data',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python surface_analyzer.py                    # Analyze all GPX files
  python surface_analyzer.py --verbose          # Show detailed progress
  python surface_analyzer.py --map              # Generate HTML maps
  python surface_analyzer.py --force --verbose  # Reanalyze all, with details
  python surface_analyzer.py --skip-api         # Fast mode (no API calls)
"""
    )
    parser.add_argument('--force', action='store_true', help='Ignore cache and reprocess all files')
    parser.add_argument('--verbose', '-v', action='store_true', help='Print detailed progress')
    parser.add_argument('--dry-run', action='store_true', help='Analyze but do not update routes.json')
    parser.add_argument('--skip-api', action='store_true', help='Skip Overpass API calls (marks all as asphalt)')
    parser.add_argument('--map', action='store_true', help='Generate HTML map for each route')
    args = parser.parse_args()

    # Determine paths
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    gpx_dir = project_root / 'data' / 'gpx'
    routes_file = project_root / 'data' / 'routes.json'
    cache_file = script_dir / CACHE_FILE

    print("Surface Analyzer for Cycling Routes v2.0")
    print("=" * 50)
    print(f"GPX directory: {gpx_dir}")
    print(f"Routes file: {routes_file}")
    print()

    # Check GPX directory
    if not gpx_dir.exists():
        print(f"Error: GPX directory not found: {gpx_dir}")
        sys.exit(1)

    # Load cache
    cache = {} if args.force else load_cache(cache_file)

    # Find GPX files
    gpx_files = sorted(gpx_dir.glob('*.gpx'))
    if not gpx_files:
        print("No GPX files found")
        sys.exit(0)

    print(f"Found {len(gpx_files)} GPX files")
    print()

    # Load existing routes.json for merging
    existing_routes = {}
    if routes_file.exists():
        try:
            with open(routes_file, 'r') as f:
                data = json.load(f)
                for route in data.get('routes', []):
                    existing_routes[route['id']] = route
        except Exception as e:
            print(f"Warning: Could not load existing routes.json: {e}")

    # Analyze each GPX file
    analyzed_routes = []
    for gpx_path in gpx_files:
        print(f"Processing: {gpx_path.name}")

        try:
            route_data = analyze_route(
                str(gpx_path), cache, args.verbose,
                args.skip_api, args.map
            )

            if route_data:
                # Merge with existing data (preserve manual edits)
                route_id = route_data['id']
                if route_id in existing_routes:
                    existing = existing_routes[route_id]
                    # Preserve color and manual notes
                    if existing.get('colore'):
                        route_data['colore'] = existing['colore']
                    if existing.get('info_extra', {}).get('nota', {}).get('it'):
                        route_data['info_extra']['nota'] = existing['info_extra']['nota']
                    if existing.get('nome', {}).get('it') != existing.get('nome', {}).get('en'):
                        route_data['nome'] = existing['nome']

                analyzed_routes.append(route_data)
                print(f"  Distance: {route_data['distanza_km']} km")
                print(f"  Elevation: {route_data['dislivello_positivo']} m")
                print(f"  Surface: {route_data['stats_fondo']['asfalto_percent']}% asphalt, "
                      f"{route_data['stats_fondo']['sterrato_percent']}% unpaved, "
                      f"{route_data['stats_fondo']['sentiero_percent']}% trail")

        except Exception as e:
            print(f"  Error: {e}")
            if args.verbose:
                import traceback
                traceback.print_exc()

        print()

    # Save cache
    save_cache(cache_file, cache)

    if args.dry_run:
        print("Dry run - routes.json not updated")
        return

    # Update routes.json
    output = {
        'routes': analyzed_routes,
        'palette_default': [
            "#E63946", "#F4A261", "#2A9D8F", "#264653", "#8338EC",
            "#FF006E", "#3A86FF", "#06D6A0", "#FFD166", "#118AB2"
        ]
    }

    # Assign colors to routes without one
    color_index = 0
    for route in output['routes']:
        if not route['colore']:
            route['colore'] = output['palette_default'][color_index % len(output['palette_default'])]
            color_index += 1

    with open(routes_file, 'w') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Updated {routes_file}")
    print(f"Analyzed {len(analyzed_routes)} routes")


if __name__ == '__main__':
    main()
