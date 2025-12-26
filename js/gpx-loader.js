/**
 * gpx-loader.js - GPX Loading and Rendering Module
 * =================================================
 * Handles loading GPX files and rendering them with surface-based styling.
 */

import mapManager from './map.js';
import { getGPX } from './api.js';

// Style configuration
const STYLES = {
    asphalt: {
        dashArray: null, // Solid line
        weight: 4,
        opacity: 0.7
    },
    unpaved: {
        dashArray: '10, 10', // Dashed line
        weight: 4,
        opacity: 0.7
    },
    trail: {
        dashArray: null,
        weight: 4,
        opacity: 0.7,
        // Trail uses double line effect
        isTrail: true
    }
};

const HOVER_STYLE = {
    weight: 6,
    opacity: 1
};

const SELECTED_STYLE = {
    weight: 8,
    opacity: 1
};

class GPXLoader {
    constructor() {
        this.routeData = new Map();
        this.listeners = {
            routeClick: [],
            routeHover: []
        };
    }

    /**
     * Load and render a GPX route
     * @param {object} route - Route metadata from routes.json
     * @returns {Promise<object>} - Route with loaded data and layers
     */
    async loadRoute(route) {
        try {
            const gpxContent = await getGPX(route.file_gpx);

            // Parse GPX to get points
            const points = this.parseGPX(gpxContent);

            if (points.length === 0) {
                console.warn(`No points found in GPX: ${route.file_gpx}`);
                return null;
            }

            // Create layer group for this route
            const layerGroup = L.layerGroup();

            // Render segments with appropriate styles
            if (route.segmenti && route.segmenti.length > 0) {
                this.renderSegments(points, route.segmenti, route.colore, layerGroup, route.id);
            } else {
                // No segments defined, render as single asphalt line
                this.renderSingleLine(points, route.colore, layerGroup, route.id);
            }

            // Calculate bounds
            const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon]));

            // Store route data
            const routeData = {
                ...route,
                points,
                bounds,
                layer: layerGroup
            };
            this.routeData.set(route.id, routeData);

            // Add to map
            mapManager.addRouteLayer(route.id, layerGroup);

            return routeData;
        } catch (error) {
            console.error(`Failed to load route ${route.id}:`, error);
            return null;
        }
    }

    /**
     * Parse GPX content and extract track points
     * @param {string} gpxContent - GPX file content
     * @returns {Array} - Array of {lat, lon, ele} objects
     */
    parseGPX(gpxContent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(gpxContent, 'application/xml');
        const points = [];

        // Find all track points
        const trkpts = doc.querySelectorAll('trkpt');
        trkpts.forEach(trkpt => {
            const lat = parseFloat(trkpt.getAttribute('lat'));
            const lon = parseFloat(trkpt.getAttribute('lon'));
            const eleNode = trkpt.querySelector('ele');
            const ele = eleNode ? parseFloat(eleNode.textContent) : 0;

            if (!isNaN(lat) && !isNaN(lon)) {
                points.push({ lat, lon, ele });
            }
        });

        return points;
    }

    /**
     * Render route segments with surface-based styling
     * @param {Array} points - Track points
     * @param {Array} segments - Segment definitions
     * @param {string} color - Route color
     * @param {L.LayerGroup} layerGroup - Layer group to add to
     * @param {string} routeId - Route ID
     */
    renderSegments(points, segments, color, layerGroup, routeId) {
        segments.forEach((segment, index) => {
            const startIdx = Math.max(0, segment.da_indice);
            const endIdx = Math.min(points.length - 1, segment.a_indice);

            if (startIdx >= endIdx) return;

            const segmentPoints = points.slice(startIdx, endIdx + 1).map(p => [p.lat, p.lon]);
            const style = STYLES[segment.tipo_fondo] || STYLES.asphalt;

            if (style.isTrail) {
                // Trail: double line effect (outer colored, inner white)
                const outerLine = L.polyline(segmentPoints, {
                    color: color,
                    weight: style.weight,
                    opacity: style.opacity,
                    lineCap: 'round',
                    lineJoin: 'round'
                });

                const innerLine = L.polyline(segmentPoints, {
                    color: '#FFFFFF',
                    weight: style.weight - 2,
                    opacity: 0.8,
                    lineCap: 'round',
                    lineJoin: 'round'
                });

                // Add click handlers
                [outerLine, innerLine].forEach(line => {
                    this.addLineInteraction(line, routeId, color);
                });

                layerGroup.addLayer(outerLine);
                layerGroup.addLayer(innerLine);
            } else {
                // Asphalt or Unpaved: single line
                const line = L.polyline(segmentPoints, {
                    color: color,
                    weight: style.weight,
                    opacity: style.opacity,
                    dashArray: style.dashArray,
                    lineCap: 'round',
                    lineJoin: 'round'
                });

                this.addLineInteraction(line, routeId, color);
                layerGroup.addLayer(line);
            }
        });
    }

    /**
     * Render a single line (when no segments defined)
     * @param {Array} points - Track points
     * @param {string} color - Route color
     * @param {L.LayerGroup} layerGroup - Layer group to add to
     * @param {string} routeId - Route ID
     */
    renderSingleLine(points, color, layerGroup, routeId) {
        const latLngs = points.map(p => [p.lat, p.lon]);
        const line = L.polyline(latLngs, {
            color: color,
            weight: 4,
            opacity: 0.7,
            lineCap: 'round',
            lineJoin: 'round'
        });

        this.addLineInteraction(line, routeId, color);
        layerGroup.addLayer(line);
    }

    /**
     * Add interaction handlers to a line
     * @param {L.Polyline} line - Polyline element
     * @param {string} routeId - Route ID
     * @param {string} color - Route color
     */
    addLineInteraction(line, routeId, color) {
        const originalStyle = {
            weight: line.options.weight,
            opacity: line.options.opacity
        };

        line.on('mouseover', () => {
            if (mapManager.getSelectedRoute() !== routeId) {
                line.setStyle(HOVER_STYLE);
                line.bringToFront();
            }
            this.notifyListeners('routeHover', { routeId, hovering: true });
        });

        line.on('mouseout', () => {
            if (mapManager.getSelectedRoute() !== routeId) {
                line.setStyle(originalStyle);
            }
            this.notifyListeners('routeHover', { routeId, hovering: false });
        });

        line.on('click', () => {
            this.notifyListeners('routeClick', { routeId });
        });
    }

    /**
     * Get route data
     * @param {string} routeId - Route ID
     * @returns {object} - Route data
     */
    getRouteData(routeId) {
        return this.routeData.get(routeId);
    }

    /**
     * Get all route data
     * @returns {Map} - All route data
     */
    getAllRouteData() {
        return this.routeData;
    }

    /**
     * Get elevation data for a route
     * @param {string} routeId - Route ID
     * @returns {Array} - Array of {distance, elevation} objects
     */
    getElevationProfile(routeId) {
        const routeData = this.routeData.get(routeId);
        if (!routeData || !routeData.points) return [];

        const profile = [];
        let totalDistance = 0;

        routeData.points.forEach((point, index) => {
            if (index > 0) {
                const prev = routeData.points[index - 1];
                totalDistance += this.haversineDistance(
                    prev.lat, prev.lon,
                    point.lat, point.lon
                );
            }

            profile.push({
                distance: totalDistance / 1000, // km
                elevation: point.ele
            });
        });

        return profile;
    }

    /**
     * Calculate distance between two points
     * @param {number} lat1 - Latitude 1
     * @param {number} lon1 - Longitude 1
     * @param {number} lat2 - Latitude 2
     * @param {number} lon2 - Longitude 2
     * @returns {number} - Distance in meters
     */
    haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth's radius in meters
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Convert degrees to radians
     * @param {number} deg - Degrees
     * @returns {number} - Radians
     */
    toRad(deg) {
        return deg * Math.PI / 180;
    }

    /**
     * Clear all loaded routes
     */
    clear() {
        this.routeData.clear();
        mapManager.clearRoutes();
    }

    /**
     * Add event listener
     * @param {string} event - Event name
     * @param {function} callback - Callback function
     */
    on(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event].push(callback);
        }
    }

    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {function} callback - Callback function
     */
    off(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }

    /**
     * Notify listeners
     * @param {string} event - Event name
     * @param {object} data - Event data
     */
    notifyListeners(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(data));
        }
    }
}

// Create and export singleton instance
const gpxLoader = new GPXLoader();
export default gpxLoader;
