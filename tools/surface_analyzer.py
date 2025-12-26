#!/usr/bin/env python3
"""
Surface Analyzer for Cycling Routes
====================================
Analyzes GPX tracks and classifies road surface types using OpenStreetMap data.

This script:
1. Reads GPX files from the data/gpx/ directory
2. Samples points from each track
3. Queries Overpass API to get road surface information
4. Classifies segments as: asphalt, unpaved, or trail
5. Updates routes.json with surface data

Usage:
    python surface_analyzer.py [--force] [--verbose]

Options:
    --force     Reprocess all files, ignoring cache
    --verbose   Print detailed progress information
"""

import os
import sys
import json
import time
import hashlib
import argparse
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime
from math import radians, sin, cos, sqrt, atan2
import urllib.request
import urllib.error
import urllib.parse

# Configuration
SAMPLE_DISTANCE_METERS = 100  # Sample a point every N meters
OVERPASS_API_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_DELAY_SECONDS = 1.5  # Delay between API calls
CACHE_FILE = "surface_cache.json"
SEARCH_RADIUS_METERS = 30  # Search radius for nearby ways

# Surface classification rules
ASPHALT_SURFACES = {'asphalt', 'paved', 'concrete', 'paving_stones', 'sett', 'cobblestone'}
UNPAVED_SURFACES = {'gravel', 'fine_gravel', 'compacted', 'dirt', 'earth', 'ground', 'unpaved', 'rock', 'pebblestone'}
TRAIL_SURFACES = {'grass', 'sand', 'mud', 'woodchips', 'wood', 'stepping_stones'}

ASPHALT_HIGHWAYS = {'primary', 'secondary', 'tertiary', 'residential', 'cycleway', 'living_street', 'service'}
UNPAVED_HIGHWAYS = {'track'}
TRAIL_HIGHWAYS = {'path', 'footway', 'bridleway', 'steps'}


class GPXParser:
    """Parse GPX files and extract track points."""

    GPX_NS = {'gpx': 'http://www.topografix.com/GPX/1/1'}

    @classmethod
    def parse(cls, file_path):
        """Parse a GPX file and return track points with elevation data."""
        tree = ET.parse(file_path)
        root = tree.getroot()

        # Handle both namespaced and non-namespaced GPX files
        points = []

        # Try with namespace first
        for trkpt in root.findall('.//gpx:trkpt', cls.GPX_NS):
            lat = float(trkpt.get('lat'))
            lon = float(trkpt.get('lon'))
            ele_elem = trkpt.find('gpx:ele', cls.GPX_NS)
            ele = float(ele_elem.text) if ele_elem is not None else 0
            points.append({'lat': lat, 'lon': lon, 'ele': ele})

        # If no points found, try without namespace
        if not points:
            for trkpt in root.findall('.//{http://www.topografix.com/GPX/1/1}trkpt'):
                lat = float(trkpt.get('lat'))
                lon = float(trkpt.get('lon'))
                ele_elem = trkpt.find('{http://www.topografix.com/GPX/1/1}ele')
                ele = float(ele_elem.text) if ele_elem is not None else 0
                points.append({'lat': lat, 'lon': lon, 'ele': ele})

        # Try completely without namespace
        if not points:
            for trkpt in root.findall('.//trkpt'):
                lat = float(trkpt.get('lat'))
                lon = float(trkpt.get('lon'))
                ele_elem = trkpt.find('ele')
                ele = float(ele_elem.text) if ele_elem is not None else 0
                points.append({'lat': lat, 'lon': lon, 'ele': ele})

        return points

    @classmethod
    def get_name(cls, file_path):
        """Extract track name from GPX file."""
        tree = ET.parse(file_path)
        root = tree.getroot()

        # Try various name locations
        for path in ['.//gpx:trk/gpx:name', './/gpx:name', './/name',
                     './/{http://www.topografix.com/GPX/1/1}trk/{http://www.topografix.com/GPX/1/1}name',
                     './/{http://www.topografix.com/GPX/1/1}name']:
            try:
                if 'gpx:' in path:
                    elem = root.find(path, cls.GPX_NS)
                else:
                    elem = root.find(path)
                if elem is not None and elem.text:
                    return elem.text
            except:
                pass

        return Path(file_path).stem


def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate the distance between two points on Earth (in meters)."""
    R = 6371000  # Earth's radius in meters

    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))

    return R * c


def sample_points(points, sample_distance=SAMPLE_DISTANCE_METERS):
    """Sample points at regular intervals along the track."""
    if not points:
        return []

    sampled = [{'point': points[0], 'index': 0}]
    accumulated_distance = 0

    for i in range(1, len(points)):
        dist = haversine_distance(
            points[i-1]['lat'], points[i-1]['lon'],
            points[i]['lat'], points[i]['lon']
        )
        accumulated_distance += dist

        if accumulated_distance >= sample_distance:
            sampled.append({'point': points[i], 'index': i})
            accumulated_distance = 0

    # Always include the last point
    if sampled[-1]['index'] != len(points) - 1:
        sampled.append({'point': points[-1], 'index': len(points) - 1})

    return sampled


def query_overpass(lat, lon, radius=SEARCH_RADIUS_METERS):
    """Query Overpass API for ways near a point."""
    query = f"""
    [out:json][timeout:25];
    (
      way(around:{radius},{lat},{lon})["highway"];
    );
    out body;
    """

    try:
        data = urllib.parse.urlencode({'data': query}).encode('utf-8')
        req = urllib.request.Request(
            OVERPASS_API_URL,
            data=data,
            headers={'User-Agent': 'CyclingRoutesAnalyzer/1.0'}
        )

        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            return result.get('elements', [])

    except urllib.error.HTTPError as e:
        if e.code == 429:
            print(f"  Rate limited, waiting 60 seconds...")
            time.sleep(60)
            return query_overpass(lat, lon, radius)
        raise
    except Exception as e:
        print(f"  Warning: Overpass query failed: {e}")
        return []


def classify_surface(ways):
    """Classify the surface type based on OSM way data."""
    if not ways:
        return 'asphalt'  # Default to asphalt if no data

    # Score each way and pick the best match
    best_classification = None
    best_score = -1

    for way in ways:
        tags = way.get('tags', {})
        highway = tags.get('highway', '')
        surface = tags.get('surface', '')
        sac_scale = tags.get('sac_scale', '')
        tracktype = tags.get('tracktype', '')

        classification = None
        score = 0

        # Check surface tag first (most reliable)
        if surface:
            surface_lower = surface.lower()
            if surface_lower in ASPHALT_SURFACES:
                classification = 'asphalt'
                score = 10
            elif surface_lower in UNPAVED_SURFACES:
                classification = 'unpaved'
                score = 10
            elif surface_lower in TRAIL_SURFACES:
                classification = 'trail'
                score = 10

        # Check sac_scale (indicates hiking trail)
        if sac_scale and not classification:
            classification = 'trail'
            score = 8

        # Check highway type if no surface specified
        if not classification:
            if highway in ASPHALT_HIGHWAYS:
                classification = 'asphalt'
                score = 5
            elif highway in UNPAVED_HIGHWAYS:
                # Track roads - check tracktype for more detail
                if tracktype in ['grade1', 'grade2']:
                    classification = 'unpaved'
                elif tracktype in ['grade4', 'grade5']:
                    classification = 'trail'
                else:
                    classification = 'unpaved'
                score = 5
            elif highway in TRAIL_HIGHWAYS:
                classification = 'trail'
                score = 5

        # Prefer cycleway over other roads
        if highway == 'cycleway':
            score += 2

        if score > best_score:
            best_score = score
            best_classification = classification

    return best_classification or 'asphalt'


def calculate_stats(segments, total_points):
    """Calculate surface statistics from segments."""
    asphalt_points = 0
    unpaved_points = 0
    trail_points = 0

    for seg in segments:
        points_in_segment = seg['a_indice'] - seg['da_indice']
        if seg['tipo_fondo'] == 'asphalt':
            asphalt_points += points_in_segment
        elif seg['tipo_fondo'] == 'unpaved':
            unpaved_points += points_in_segment
        else:
            trail_points += points_in_segment

    total = asphalt_points + unpaved_points + trail_points
    if total == 0:
        return {'asfalto_percent': 100, 'sterrato_percent': 0, 'sentiero_percent': 0}

    return {
        'asfalto_percent': round(asphalt_points / total * 100),
        'sterrato_percent': round(unpaved_points / total * 100),
        'sentiero_percent': round(trail_points / total * 100)
    }


def calculate_distance(points):
    """Calculate total distance of track in km."""
    total = 0
    for i in range(1, len(points)):
        total += haversine_distance(
            points[i-1]['lat'], points[i-1]['lon'],
            points[i]['lat'], points[i]['lon']
        )
    return round(total / 1000, 1)


def calculate_elevation_gain(points):
    """Calculate positive elevation gain in meters."""
    gain = 0
    for i in range(1, len(points)):
        diff = points[i]['ele'] - points[i-1]['ele']
        if diff > 0:
            gain += diff
    return round(gain)


def get_file_hash(file_path):
    """Get MD5 hash of a file for caching purposes."""
    with open(file_path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()


def load_cache(cache_path):
    """Load the analysis cache."""
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'r') as f:
                return json.load(f)
        except:
            pass
    return {}


def save_cache(cache_path, cache):
    """Save the analysis cache."""
    with open(cache_path, 'w') as f:
        json.dump(cache, f, indent=2)


def analyze_route(gpx_path, cache, verbose=False):
    """Analyze a single GPX file and return route data."""
    file_hash = get_file_hash(gpx_path)
    file_name = os.path.basename(gpx_path)

    # Check cache
    if file_name in cache and cache[file_name].get('hash') == file_hash:
        if verbose:
            print(f"  Using cached data for {file_name}")
        return cache[file_name]['data']

    if verbose:
        print(f"  Analyzing {file_name}...")

    # Parse GPX
    points = GPXParser.parse(gpx_path)
    if not points:
        print(f"  Warning: No points found in {file_name}")
        return None

    name = GPXParser.get_name(gpx_path)

    # Sample points
    sampled = sample_points(points)
    if verbose:
        print(f"    {len(points)} points, sampled to {len(sampled)} points")

    # Classify each sampled point
    classifications = []
    for i, sample in enumerate(sampled):
        pt = sample['point']

        if verbose and i > 0 and i % 10 == 0:
            print(f"    Processed {i}/{len(sampled)} samples...")

        ways = query_overpass(pt['lat'], pt['lon'])
        classification = classify_surface(ways)
        classifications.append({
            'index': sample['index'],
            'type': classification
        })

        # Rate limiting
        time.sleep(OVERPASS_DELAY_SECONDS)

    # Build segments from classifications
    segments = []
    if classifications:
        current_type = classifications[0]['type']
        current_start = classifications[0]['index']

        for i in range(1, len(classifications)):
            if classifications[i]['type'] != current_type:
                segments.append({
                    'da_indice': current_start,
                    'a_indice': classifications[i]['index'],
                    'tipo_fondo': current_type
                })
                current_type = classifications[i]['type']
                current_start = classifications[i]['index']

        # Add final segment
        segments.append({
            'da_indice': current_start,
            'a_indice': len(points) - 1,
            'tipo_fondo': current_type
        })

    # Calculate statistics
    stats = calculate_stats(segments, len(points))
    distance = calculate_distance(points)
    elevation = calculate_elevation_gain(points)

    route_data = {
        'id': Path(gpx_path).stem,
        'nome': {
            'it': name,
            'en': name
        },
        'file_gpx': file_name,
        'colore': None,
        'distanza_km': distance,
        'dislivello_positivo': elevation,
        'stats_fondo': stats,
        'segmenti': segments,
        'info_extra': {
            'difficolta': 'media' if stats['sentiero_percent'] > 0 else ('facile' if stats['sterrato_percent'] == 0 else 'media'),
            'nota': {
                'it': '',
                'en': ''
            }
        }
    }

    # Update cache
    cache[file_name] = {
        'hash': file_hash,
        'data': route_data,
        'analyzed': datetime.now().isoformat()
    }

    return route_data


def main():
    parser = argparse.ArgumentParser(description='Analyze GPX routes for surface types')
    parser.add_argument('--force', action='store_true', help='Ignore cache and reprocess all files')
    parser.add_argument('--verbose', '-v', action='store_true', help='Print detailed progress')
    parser.add_argument('--dry-run', action='store_true', help='Analyze but do not update routes.json')
    args = parser.parse_args()

    # Determine paths
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    gpx_dir = project_root / 'data' / 'gpx'
    routes_file = project_root / 'data' / 'routes.json'
    cache_file = script_dir / CACHE_FILE

    print("Surface Analyzer for Cycling Routes")
    print("=" * 40)
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
    gpx_files = list(gpx_dir.glob('*.gpx'))
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
    for gpx_path in sorted(gpx_files):
        print(f"Processing: {gpx_path.name}")

        try:
            route_data = analyze_route(str(gpx_path), cache, args.verbose)
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
