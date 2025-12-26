/**
 * poi-manager.js - POI Management Module
 * =======================================
 * Handles loading and displaying Points of Interest.
 */

import mapManager from './map.js';
import { getPOI } from './api.js';
import i18n, { localize } from './i18n.js';

// POI type to icon mapping
const POI_ICONS = {
    partenza_arrivo: 'icons/partenza.svg',
    vista: 'icons/vista.svg',
    fontana: 'icons/fontana.svg',
    ristoro: 'icons/ristoro.svg',
    bike_service: 'icons/bike-service.svg'
};

// Default icon size
const ICON_SIZE = [32, 32];
const ICON_ANCHOR = [16, 32];
const POPUP_ANCHOR = [0, -32];

class POIManager {
    constructor() {
        this.poiData = [];
        this.markers = new Map();
        this.markerCluster = null;
        this.visibleTypes = new Set(['partenza_arrivo', 'vista', 'fontana', 'ristoro', 'bike_service']);
    }

    /**
     * Initialize POI manager
     */
    async init() {
        try {
            this.poiData = await getPOI();
            this.createMarkers();
            this.updateVisibility();
        } catch (error) {
            console.error('Failed to load POI:', error);
        }
    }

    /**
     * Create markers for all POI
     */
    createMarkers() {
        const map = mapManager.getMap();
        if (!map) return;

        // Create marker cluster group
        this.markerCluster = L.markerClusterGroup({
            maxClusterRadius: 50,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            disableClusteringAtZoom: 14
        });

        // Create markers for each POI
        this.poiData.forEach(poi => {
            const icon = this.createIcon(poi.tipo);
            const marker = L.marker(poi.coordinate, {
                icon: icon,
                poiType: poi.tipo,
                poiId: poi.id
            });

            // Create popup
            const popupContent = this.createPopupContent(poi);
            marker.bindPopup(popupContent, {
                maxWidth: 250,
                className: 'poi-popup-wrapper'
            });

            this.markers.set(poi.id, marker);
            this.markerCluster.addLayer(marker);
        });

        // Add cluster to map
        mapManager.setPOILayer(this.markerCluster);

        // Update popups when language changes
        i18n.onLanguageChange(() => this.updatePopups());
    }

    /**
     * Create a custom icon for a POI type
     * @param {string} type - POI type
     * @returns {L.Icon} - Leaflet icon
     */
    createIcon(type) {
        const iconUrl = POI_ICONS[type] || POI_ICONS.vista;

        return L.icon({
            iconUrl: iconUrl,
            iconSize: ICON_SIZE,
            iconAnchor: ICON_ANCHOR,
            popupAnchor: POPUP_ANCHOR,
            className: `poi-marker poi-marker-${type}`
        });
    }

    /**
     * Create popup content for a POI
     * @param {object} poi - POI data
     * @returns {string} - HTML content
     */
    createPopupContent(poi) {
        const name = localize(poi.nome);
        const note = localize(poi.nota);
        const iconUrl = POI_ICONS[poi.tipo] || POI_ICONS.vista;

        return `
            <div class="poi-popup">
                <div class="poi-popup-title">
                    <img src="${iconUrl}" alt="">
                    ${name}
                </div>
                ${note ? `<div class="poi-popup-note">${note}</div>` : ''}
            </div>
        `;
    }

    /**
     * Update all popup contents (for language changes)
     */
    updatePopups() {
        this.poiData.forEach(poi => {
            const marker = this.markers.get(poi.id);
            if (marker) {
                const content = this.createPopupContent(poi);
                marker.setPopupContent(content);
            }
        });
    }

    /**
     * Set visibility of a POI type
     * @param {string} type - POI type
     * @param {boolean} visible - Visibility state
     */
    setTypeVisibility(type, visible) {
        if (visible) {
            this.visibleTypes.add(type);
        } else {
            this.visibleTypes.delete(type);
        }
        this.updateVisibility();
    }

    /**
     * Update marker visibility based on visible types
     */
    updateVisibility() {
        if (!this.markerCluster) return;

        this.poiData.forEach(poi => {
            const marker = this.markers.get(poi.id);
            if (marker) {
                if (this.visibleTypes.has(poi.tipo)) {
                    if (!this.markerCluster.hasLayer(marker)) {
                        this.markerCluster.addLayer(marker);
                    }
                } else {
                    this.markerCluster.removeLayer(marker);
                }
            }
        });
    }

    /**
     * Show all POI types
     */
    showAll() {
        Object.keys(POI_ICONS).forEach(type => {
            this.visibleTypes.add(type);
        });
        this.updateVisibility();
    }

    /**
     * Hide all POI types
     */
    hideAll() {
        this.visibleTypes.clear();
        this.updateVisibility();
    }

    /**
     * Get POI by ID
     * @param {string} id - POI ID
     * @returns {object} - POI data
     */
    getPOI(id) {
        return this.poiData.find(poi => poi.id === id);
    }

    /**
     * Get all POI data
     * @returns {Array} - All POI
     */
    getAllPOI() {
        return this.poiData;
    }

    /**
     * Get POI by type
     * @param {string} type - POI type
     * @returns {Array} - POI of specified type
     */
    getPOIByType(type) {
        return this.poiData.filter(poi => poi.tipo === type);
    }

    /**
     * Focus on a specific POI
     * @param {string} id - POI ID
     * @param {boolean} openPopup - Whether to open the popup
     */
    focusPOI(id, openPopup = true) {
        const marker = this.markers.get(id);
        const poi = this.getPOI(id);

        if (marker && poi) {
            const map = mapManager.getMap();
            map.setView(poi.coordinate, 16);

            if (openPopup) {
                // Ensure the marker is visible (expand cluster if needed)
                this.markerCluster.zoomToShowLayer(marker, () => {
                    marker.openPopup();
                });
            }
        }
    }

    /**
     * Clear all POI
     */
    clear() {
        if (this.markerCluster) {
            this.markerCluster.clearLayers();
        }
        this.markers.clear();
        this.poiData = [];
        mapManager.clearPOI();
    }
}

// Create and export singleton instance
const poiManager = new POIManager();
export default poiManager;
