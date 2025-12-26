/**
 * map.js - Map Management Module
 * ==============================
 * Handles Leaflet map initialization and management.
 */

class MapManager {
    constructor() {
        this.map = null;
        this.routeLayers = new Map();
        this.poiLayer = null;
        this.selectedRoute = null;
        this.defaultCenter = [45.48, 10.68]; // Basso Lago di Garda
        this.defaultZoom = 12;
    }

    /**
     * Initialize the map
     * @param {string} containerId - Map container element ID
     * @param {object} options - Map options
     */
    init(containerId, options = {}) {
        // Check URL parameters for initial position
        const urlParams = new URLSearchParams(window.location.search);
        const lat = parseFloat(urlParams.get('lat')) || this.defaultCenter[0];
        const lng = parseFloat(urlParams.get('lng')) || this.defaultCenter[1];
        const zoom = parseInt(urlParams.get('zoom')) || this.defaultZoom;

        // Create map
        this.map = L.map(containerId, {
            center: [lat, lng],
            zoom: zoom,
            zoomControl: true,
            scrollWheelZoom: true,
            ...options
        });

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(this.map);

        // Add scale control
        L.control.scale({
            metric: true,
            imperial: false,
            position: 'bottomleft'
        }).addTo(this.map);

        // Listen for map movements to update URL
        this.map.on('moveend', () => this.updateURLPosition());

        return this.map;
    }

    /**
     * Get the Leaflet map instance
     * @returns {L.Map} - Leaflet map
     */
    getMap() {
        return this.map;
    }

    /**
     * Update URL with current map position
     */
    updateURLPosition() {
        if (!this.map) return;

        const center = this.map.getCenter();
        const zoom = this.map.getZoom();
        const url = new URL(window.location);

        url.searchParams.set('lat', center.lat.toFixed(4));
        url.searchParams.set('lng', center.lng.toFixed(4));
        url.searchParams.set('zoom', zoom);

        window.history.replaceState({}, '', url);
    }

    /**
     * Fit map to bounds of all routes
     * @param {Array} routes - Array of route objects with bounds
     */
    fitToRoutes(routes) {
        if (!this.map || routes.length === 0) return;

        const bounds = L.latLngBounds();
        routes.forEach(route => {
            if (route.bounds) {
                bounds.extend(route.bounds);
            }
        });

        if (bounds.isValid()) {
            this.map.fitBounds(bounds, {
                padding: [50, 50],
                maxZoom: 14
            });
        }
    }

    /**
     * Add a route layer to the map
     * @param {string} routeId - Route identifier
     * @param {L.LayerGroup} layer - Leaflet layer group
     */
    addRouteLayer(routeId, layer) {
        if (this.routeLayers.has(routeId)) {
            this.removeRouteLayer(routeId);
        }
        this.routeLayers.set(routeId, layer);
        layer.addTo(this.map);
    }

    /**
     * Remove a route layer from the map
     * @param {string} routeId - Route identifier
     */
    removeRouteLayer(routeId) {
        const layer = this.routeLayers.get(routeId);
        if (layer) {
            this.map.removeLayer(layer);
            this.routeLayers.delete(routeId);
        }
    }

    /**
     * Get a route layer
     * @param {string} routeId - Route identifier
     * @returns {L.LayerGroup} - Route layer
     */
    getRouteLayer(routeId) {
        return this.routeLayers.get(routeId);
    }

    /**
     * Set route visibility
     * @param {string} routeId - Route identifier
     * @param {boolean} visible - Visibility state
     */
    setRouteVisibility(routeId, visible) {
        const layer = this.routeLayers.get(routeId);
        if (layer) {
            if (visible) {
                layer.addTo(this.map);
            } else {
                this.map.removeLayer(layer);
            }
        }
    }

    /**
     * Highlight a route (for hover)
     * @param {string} routeId - Route identifier
     * @param {boolean} highlight - Highlight state
     */
    highlightRoute(routeId, highlight) {
        const layer = this.routeLayers.get(routeId);
        if (layer) {
            layer.eachLayer(sublayer => {
                if (sublayer.setStyle) {
                    sublayer.setStyle({
                        weight: highlight ? 6 : 4,
                        opacity: highlight ? 1 : 0.7
                    });
                }
            });
            if (highlight) {
                layer.bringToFront();
            }
        }
    }

    /**
     * Select a route
     * @param {string} routeId - Route identifier
     */
    selectRoute(routeId) {
        // Deselect previous
        if (this.selectedRoute && this.selectedRoute !== routeId) {
            this.highlightRoute(this.selectedRoute, false);
        }

        this.selectedRoute = routeId;

        if (routeId) {
            this.highlightRoute(routeId, true);

            // Update URL
            const url = new URL(window.location);
            url.searchParams.set('route', routeId);
            window.history.replaceState({}, '', url);

            // Fit to route bounds
            const layer = this.routeLayers.get(routeId);
            if (layer) {
                const bounds = layer.getBounds();
                if (bounds.isValid()) {
                    this.map.fitBounds(bounds, {
                        padding: [50, 50],
                        maxZoom: 15
                    });
                }
            }
        } else {
            // Remove route from URL
            const url = new URL(window.location);
            url.searchParams.delete('route');
            window.history.replaceState({}, '', url);
        }
    }

    /**
     * Get selected route ID
     * @returns {string|null} - Selected route ID
     */
    getSelectedRoute() {
        return this.selectedRoute;
    }

    /**
     * Set POI layer
     * @param {L.LayerGroup} layer - POI layer group
     */
    setPOILayer(layer) {
        if (this.poiLayer) {
            this.map.removeLayer(this.poiLayer);
        }
        this.poiLayer = layer;
        layer.addTo(this.map);
    }

    /**
     * Get POI layer
     * @returns {L.LayerGroup} - POI layer
     */
    getPOILayer() {
        return this.poiLayer;
    }

    /**
     * Set POI visibility by type
     * @param {string} type - POI type
     * @param {boolean} visible - Visibility state
     */
    setPOITypeVisibility(type, visible) {
        if (!this.poiLayer) return;

        this.poiLayer.eachLayer(layer => {
            if (layer.options && layer.options.poiType === type) {
                if (visible) {
                    if (!this.map.hasLayer(layer)) {
                        this.poiLayer.addLayer(layer);
                    }
                } else {
                    this.poiLayer.removeLayer(layer);
                }
            }
        });
    }

    /**
     * Clear all route layers
     */
    clearRoutes() {
        this.routeLayers.forEach((layer, id) => {
            this.map.removeLayer(layer);
        });
        this.routeLayers.clear();
        this.selectedRoute = null;
    }

    /**
     * Clear POI layer
     */
    clearPOI() {
        if (this.poiLayer) {
            this.map.removeLayer(this.poiLayer);
            this.poiLayer = null;
        }
    }

    /**
     * Get initial route from URL
     * @returns {string|null} - Route ID from URL
     */
    getInitialRouteFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('route');
    }
}

// Create and export singleton instance
const mapManager = new MapManager();
export default mapManager;
