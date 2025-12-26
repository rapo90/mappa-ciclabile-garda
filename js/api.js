/**
 * api.js - Data Fetching Module
 * =============================
 * Handles all data fetching operations.
 * Designed for easy migration to a backend API.
 */

// API Configuration
// Set to empty string for static files, or API URL for backend
const API_BASE = '';

/**
 * Apply filters to routes locally (static mode)
 * @param {Array} routes - Array of route objects
 * @param {object} filters - Filter criteria
 * @returns {Array} - Filtered routes
 */
function applyFiltersLocally(routes, filters = {}) {
    let filtered = [...routes];

    if (filters.surface) {
        switch (filters.surface) {
            case 'asphalt':
                // Only routes that are 100% asphalt
                filtered = filtered.filter(r => r.stats_fondo.asfalto_percent === 100);
                break;
            case 'unpaved':
                // Routes with no trails (asphalt + unpaved only)
                filtered = filtered.filter(r => r.stats_fondo.sentiero_percent === 0);
                break;
            case 'trails':
                // All routes allowed (no filter)
                break;
            default:
                // 'all' - no filter
                break;
        }
    }

    return filtered;
}

/**
 * Fetch routes data
 * @param {object} filters - Optional filter criteria
 * @returns {Promise<Array>} - Array of route objects
 */
export async function fetchRoutes(filters = {}) {
    if (API_BASE) {
        // Future: API call with filters
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value) params.append(key, value);
        });

        const response = await fetch(`${API_BASE}/api/routes?${params}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch routes: ${response.status}`);
        }
        return response.json();
    } else {
        // Static mode: load from JSON file
        const response = await fetch('data/routes.json');
        if (!response.ok) {
            throw new Error(`Failed to fetch routes: ${response.status}`);
        }
        const data = await response.json();
        return applyFiltersLocally(data.routes || [], filters);
    }
}

/**
 * Fetch POI data
 * @param {object} filters - Optional filter criteria (e.g., type)
 * @returns {Promise<Array>} - Array of POI objects
 */
export async function fetchPOI(filters = {}) {
    if (API_BASE) {
        // Future: API call
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([key, value]) => {
            if (value) params.append(key, value);
        });

        const response = await fetch(`${API_BASE}/api/poi?${params}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch POI: ${response.status}`);
        }
        return response.json();
    } else {
        // Static mode: load from JSON file
        const response = await fetch('data/poi.json');
        if (!response.ok) {
            throw new Error(`Failed to fetch POI: ${response.status}`);
        }
        const data = await response.json();

        // Apply type filter if specified
        let poi = data.poi || [];
        if (filters.types && Array.isArray(filters.types)) {
            poi = poi.filter(p => filters.types.includes(p.tipo));
        }

        return poi;
    }
}

/**
 * Fetch GPX file content
 * @param {string} filename - GPX filename
 * @returns {Promise<string>} - GPX file content as string
 */
export async function fetchGPX(filename) {
    const path = API_BASE ? `${API_BASE}/api/gpx/${filename}` : `data/gpx/${filename}`;

    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`Failed to fetch GPX file: ${filename}`);
    }
    return response.text();
}

/**
 * Get download URL for a GPX file
 * @param {string} filename - GPX filename
 * @returns {string} - Download URL
 */
export function getGPXDownloadURL(filename) {
    return API_BASE ? `${API_BASE}/api/gpx/${filename}` : `data/gpx/${filename}`;
}

/**
 * Future: Get route recommendation based on preferences
 * @param {object} preferences - User preferences
 * @returns {Promise<object>} - Recommended route
 */
export async function getRouteRecommendation(preferences) {
    if (API_BASE) {
        const response = await fetch(`${API_BASE}/api/recommend`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(preferences)
        });
        if (!response.ok) {
            throw new Error('Failed to get recommendation');
        }
        return response.json();
    } else {
        // Static mode: simple local recommendation
        const routes = await fetchRoutes();

        // Filter by preferences
        let candidates = routes;

        if (preferences.distanza_max) {
            candidates = candidates.filter(r => r.distanza_km <= preferences.distanza_max);
        }

        if (preferences.sterrato_max !== undefined) {
            candidates = candidates.filter(r => r.stats_fondo.sterrato_percent <= preferences.sterrato_max);
        }

        if (preferences.sentiero_max !== undefined) {
            candidates = candidates.filter(r => r.stats_fondo.sentiero_percent <= preferences.sentiero_max);
        }

        // Return first match or null
        return candidates.length > 0 ? candidates[0] : null;
    }
}

// Cache for loaded data
const cache = {
    routes: null,
    poi: null,
    gpx: new Map()
};

/**
 * Get cached routes or fetch if not available
 * @param {object} filters - Filter criteria
 * @param {boolean} forceRefresh - Force refresh from source
 * @returns {Promise<Array>} - Routes array
 */
export async function getRoutes(filters = {}, forceRefresh = false) {
    if (!cache.routes || forceRefresh) {
        cache.routes = await fetchRoutes({});
    }
    return applyFiltersLocally(cache.routes, filters);
}

/**
 * Get cached POI or fetch if not available
 * @param {boolean} forceRefresh - Force refresh from source
 * @returns {Promise<Array>} - POI array
 */
export async function getPOI(forceRefresh = false) {
    if (!cache.poi || forceRefresh) {
        cache.poi = await fetchPOI();
    }
    return cache.poi;
}

/**
 * Get cached GPX or fetch if not available
 * @param {string} filename - GPX filename
 * @returns {Promise<string>} - GPX content
 */
export async function getGPX(filename) {
    if (!cache.gpx.has(filename)) {
        const content = await fetchGPX(filename);
        cache.gpx.set(filename, content);
    }
    return cache.gpx.get(filename);
}

/**
 * Clear all cached data
 */
export function clearCache() {
    cache.routes = null;
    cache.poi = null;
    cache.gpx.clear();
}
