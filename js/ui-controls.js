/**
 * ui-controls.js - UI Controls Module
 * ====================================
 * Handles all UI interactions: filters, sidebar, route info panel.
 */

import i18n, { t, localize } from './i18n.js';
import { getRoutes, getGPXDownloadURL } from './api.js';
import mapManager from './map.js';
import gpxLoader from './gpx-loader.js';
import poiManager from './poi-manager.js';

class UIControls {
    constructor() {
        this.currentFilter = 'all';
        this.allRoutes = [];
        this.filteredRoutes = [];
        this.selectedRouteId = null;
        this.sidebarOpen = false;
    }

    /**
     * Initialize UI controls
     * @param {Array} routes - All routes data
     */
    init(routes) {
        this.allRoutes = routes;
        this.filteredRoutes = routes;

        this.setupLanguageSwitcher();
        this.setupSidebarToggle();
        this.setupSurfaceFilters();
        this.setupShowAllRoutes();
        this.setupPOIFilters();
        this.setupRouteInfoPanel();
        this.renderRoutesList();

        // Listen for route clicks from GPX loader
        gpxLoader.on('routeClick', ({ routeId }) => {
            this.selectRoute(routeId);
        });

        // Listen for hover events
        gpxLoader.on('routeHover', ({ routeId, hovering }) => {
            this.highlightRouteItem(routeId, hovering);
        });

        // Listen for language changes
        i18n.onLanguageChange(() => {
            this.renderRoutesList();
            this.updateRouteInfoPanel();
        });

        // Check for route in URL
        const urlRoute = mapManager.getInitialRouteFromURL();
        if (urlRoute) {
            setTimeout(() => this.selectRoute(urlRoute), 500);
        }
    }

    /**
     * Setup language switcher
     */
    setupLanguageSwitcher() {
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const lang = btn.dataset.lang;
                i18n.setLanguage(lang);
            });
        });
    }

    /**
     * Setup sidebar toggle for mobile
     */
    setupSidebarToggle() {
        const toggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('sidebar');

        if (toggle && sidebar) {
            toggle.addEventListener('click', () => {
                this.sidebarOpen = !this.sidebarOpen;
                sidebar.classList.toggle('open', this.sidebarOpen);
                toggle.classList.toggle('active', this.sidebarOpen);
            });

            // Close sidebar when clicking outside on mobile
            document.addEventListener('click', (e) => {
                if (this.sidebarOpen &&
                    !sidebar.contains(e.target) &&
                    !toggle.contains(e.target)) {
                    this.sidebarOpen = false;
                    sidebar.classList.remove('open');
                    toggle.classList.remove('active');
                }
            });
        }
    }

    /**
     * Setup surface filter controls
     */
    setupSurfaceFilters() {
        document.querySelectorAll('input[name="surface-filter"]').forEach(input => {
            input.addEventListener('change', async (e) => {
                this.currentFilter = e.target.value;
                await this.applyFilters();
            });
        });
    }

    /**
     * Setup "show all routes" toggle
     */
    setupShowAllRoutes() {
        const toggle = document.getElementById('showAllRoutes');
        if (toggle) {
            toggle.addEventListener('change', (e) => {
                const show = e.target.checked;
                this.allRoutes.forEach(route => {
                    mapManager.setRouteVisibility(route.id, show);
                });
            });
        }
    }

    /**
     * Setup POI filter toggles
     */
    setupPOIFilters() {
        document.querySelectorAll('.poi-toggle').forEach(toggle => {
            toggle.addEventListener('change', (e) => {
                const type = e.target.dataset.poiType;
                const visible = e.target.checked;
                poiManager.setTypeVisibility(type, visible);
            });
        });
    }

    /**
     * Setup route info panel
     */
    setupRouteInfoPanel() {
        const closeBtn = document.getElementById('closeRouteInfo');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.deselectRoute();
            });
        }
    }

    /**
     * Apply current filters
     */
    async applyFilters() {
        const filter = this.currentFilter === 'all' ? {} : { surface: this.currentFilter };
        this.filteredRoutes = await getRoutes(filter);

        // Update visibility
        this.allRoutes.forEach(route => {
            const isVisible = this.filteredRoutes.some(r => r.id === route.id);
            mapManager.setRouteVisibility(route.id, isVisible);
        });

        // Update routes list
        this.renderRoutesList();

        // Deselect if current route is filtered out
        if (this.selectedRouteId) {
            const stillVisible = this.filteredRoutes.some(r => r.id === this.selectedRouteId);
            if (!stillVisible) {
                this.deselectRoute();
            }
        }
    }

    /**
     * Render routes list in sidebar
     */
    renderRoutesList() {
        const container = document.getElementById('routesList');
        if (!container) return;

        container.innerHTML = '';

        if (this.filteredRoutes.length === 0) {
            container.innerHTML = `<p class="no-routes">${t('no_routes')}</p>`;
            return;
        }

        this.filteredRoutes.forEach(route => {
            const item = document.createElement('div');
            item.className = 'route-item';
            item.dataset.routeId = route.id;

            if (route.id === this.selectedRouteId) {
                item.classList.add('active');
            }

            item.innerHTML = `
                <span class="route-color" style="background-color: ${route.colore}"></span>
                <span class="route-name">${localize(route.nome)}</span>
                <span class="route-distance">${route.distanza_km} km</span>
            `;

            item.addEventListener('click', () => {
                this.selectRoute(route.id);
            });

            item.addEventListener('mouseenter', () => {
                mapManager.highlightRoute(route.id, true);
            });

            item.addEventListener('mouseleave', () => {
                if (route.id !== this.selectedRouteId) {
                    mapManager.highlightRoute(route.id, false);
                }
            });

            container.appendChild(item);
        });
    }

    /**
     * Highlight route item in list
     * @param {string} routeId - Route ID
     * @param {boolean} highlight - Highlight state
     */
    highlightRouteItem(routeId, highlight) {
        const item = document.querySelector(`.route-item[data-route-id="${routeId}"]`);
        if (item && routeId !== this.selectedRouteId) {
            item.style.backgroundColor = highlight ? '#E0E0E0' : '';
        }
    }

    /**
     * Select a route
     * @param {string} routeId - Route ID
     */
    selectRoute(routeId) {
        // Update UI state
        this.selectedRouteId = routeId;

        // Update route list
        document.querySelectorAll('.route-item').forEach(item => {
            item.classList.toggle('active', item.dataset.routeId === routeId);
        });

        // Update map
        mapManager.selectRoute(routeId);

        // Show route info panel
        this.showRouteInfo(routeId);

        // Close sidebar on mobile
        if (window.innerWidth <= 768 && this.sidebarOpen) {
            const sidebar = document.getElementById('sidebar');
            const toggle = document.getElementById('sidebarToggle');
            this.sidebarOpen = false;
            if (sidebar) sidebar.classList.remove('open');
            if (toggle) toggle.classList.remove('active');
        }
    }

    /**
     * Deselect current route
     */
    deselectRoute() {
        this.selectedRouteId = null;

        // Update route list
        document.querySelectorAll('.route-item').forEach(item => {
            item.classList.remove('active');
        });

        // Update map
        mapManager.selectRoute(null);

        // Hide route info panel
        this.hideRouteInfo();
    }

    /**
     * Show route info panel
     * @param {string} routeId - Route ID
     */
    showRouteInfo(routeId) {
        const panel = document.getElementById('routeInfoPanel');
        const content = document.getElementById('routeInfoContent');

        if (!panel || !content) return;

        const route = this.allRoutes.find(r => r.id === routeId);
        if (!route) return;

        // Build content
        const difficultyClass = this.getDifficultyClass(route.info_extra?.difficolta);
        const difficultyLabel = this.getDifficultyLabel(route.info_extra?.difficolta);

        content.innerHTML = `
            <div class="route-info-header">
                <span class="route-info-color" style="background-color: ${route.colore}"></span>
                <h3 class="route-info-name">${localize(route.nome)}</h3>
            </div>

            <div class="route-info-stats">
                <div class="stat-item">
                    <div class="stat-label">${t('distance')}</div>
                    <div class="stat-value">${route.distanza_km} <small>km</small></div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">${t('elevation_gain')}</div>
                    <div class="stat-value">${route.dislivello_positivo} <small>m</small></div>
                </div>
            </div>

            <div class="surface-breakdown">
                <div class="info-label">${t('surface_breakdown')}</div>
                <div class="surface-chart">
                    ${route.stats_fondo.asfalto_percent > 0 ?
                        `<div class="surface-bar asphalt" style="flex: ${route.stats_fondo.asfalto_percent}">${route.stats_fondo.asfalto_percent}%</div>` : ''}
                    ${route.stats_fondo.sterrato_percent > 0 ?
                        `<div class="surface-bar unpaved" style="flex: ${route.stats_fondo.sterrato_percent}">${route.stats_fondo.sterrato_percent}%</div>` : ''}
                    ${route.stats_fondo.sentiero_percent > 0 ?
                        `<div class="surface-bar trail" style="flex: ${route.stats_fondo.sentiero_percent}">${route.stats_fondo.sentiero_percent}%</div>` : ''}
                </div>
                <div class="surface-legend">
                    <div class="surface-legend-item">
                        <span class="surface-legend-dot asphalt"></span>
                        <span>${t('asphalt')}</span>
                    </div>
                    <div class="surface-legend-item">
                        <span class="surface-legend-dot unpaved"></span>
                        <span>${t('unpaved')}</span>
                    </div>
                    <div class="surface-legend-item">
                        <span class="surface-legend-dot trail"></span>
                        <span>${t('trail')}</span>
                    </div>
                </div>
            </div>

            ${route.info_extra?.difficolta ? `
                <div class="route-info-difficulty">
                    <div class="info-label">${t('difficulty')}</div>
                    <span class="difficulty-badge ${difficultyClass}">${difficultyLabel}</span>
                    ${route.info_extra?.tempo_stimato ? `<span style="margin-left: 8px; color: #666;">${route.info_extra.tempo_stimato}</span>` : ''}
                </div>
            ` : ''}

            ${route.info_extra?.nota && localize(route.info_extra.nota) ? `
                <div class="route-info-note">
                    <div class="info-label">Note</div>
                    <div class="info-value">${localize(route.info_extra.nota)}</div>
                </div>
            ` : ''}

            <button class="download-gpx-btn" onclick="window.open('${getGPXDownloadURL(route.file_gpx)}', '_blank')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                ${t('download_gpx')}
            </button>

            <div class="elevation-profile">
                <div class="elevation-profile-title">${t('elevation_profile')}</div>
                <div id="elevationChart"></div>
            </div>
        `;

        // Show panel
        panel.classList.add('visible');

        // Render elevation chart
        this.renderElevationChart(routeId);
    }

    /**
     * Hide route info panel
     */
    hideRouteInfo() {
        const panel = document.getElementById('routeInfoPanel');
        if (panel) {
            panel.classList.remove('visible');
        }
    }

    /**
     * Update route info panel (for language changes)
     */
    updateRouteInfoPanel() {
        if (this.selectedRouteId) {
            this.showRouteInfo(this.selectedRouteId);
        }
    }

    /**
     * Get difficulty CSS class
     * @param {string} difficulty - Difficulty value
     * @returns {string} - CSS class
     */
    getDifficultyClass(difficulty) {
        switch (difficulty) {
            case 'facile':
            case 'easy':
                return 'easy';
            case 'media':
            case 'medium':
                return 'medium';
            case 'difficile':
            case 'hard':
                return 'hard';
            default:
                return 'medium';
        }
    }

    /**
     * Get localized difficulty label
     * @param {string} difficulty - Difficulty value
     * @returns {string} - Localized label
     */
    getDifficultyLabel(difficulty) {
        switch (difficulty) {
            case 'facile':
            case 'easy':
                return t('difficulty_easy');
            case 'media':
            case 'medium':
                return t('difficulty_medium');
            case 'difficile':
            case 'hard':
                return t('difficulty_hard');
            default:
                return t('difficulty_medium');
        }
    }

    /**
     * Render elevation chart
     * @param {string} routeId - Route ID
     */
    renderElevationChart(routeId) {
        const container = document.getElementById('elevationChart');
        if (!container) return;

        const profile = gpxLoader.getElevationProfile(routeId);
        if (profile.length === 0) {
            container.innerHTML = '<p style="text-align: center; padding: 20px; color: #666;">No elevation data</p>';
            return;
        }

        // Simple SVG chart
        const width = container.clientWidth;
        const height = 120;
        const padding = { top: 10, right: 10, bottom: 25, left: 40 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const maxDist = Math.max(...profile.map(p => p.distance));
        const minEle = Math.min(...profile.map(p => p.elevation));
        const maxEle = Math.max(...profile.map(p => p.elevation));
        const eleRange = maxEle - minEle || 1;

        // Scale functions
        const xScale = d => (d / maxDist) * chartWidth + padding.left;
        const yScale = e => chartHeight - ((e - minEle) / eleRange) * chartHeight + padding.top;

        // Build path
        let pathD = `M ${xScale(profile[0].distance)} ${yScale(profile[0].elevation)}`;
        for (let i = 1; i < profile.length; i++) {
            pathD += ` L ${xScale(profile[i].distance)} ${yScale(profile[i].elevation)}`;
        }

        // Area path
        let areaD = pathD + ` L ${xScale(profile[profile.length - 1].distance)} ${height - padding.bottom} L ${xScale(0)} ${height - padding.bottom} Z`;

        container.innerHTML = `
            <svg width="${width}" height="${height}">
                <defs>
                    <linearGradient id="elevGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:#2A9D8F;stop-opacity:0.4" />
                        <stop offset="100%" style="stop-color:#2A9D8F;stop-opacity:0.1" />
                    </linearGradient>
                </defs>
                <path d="${areaD}" fill="url(#elevGradient)" />
                <path d="${pathD}" fill="none" stroke="#2A9D8F" stroke-width="2" />

                <!-- X axis labels -->
                <text x="${padding.left}" y="${height - 5}" font-size="10" fill="#666">0</text>
                <text x="${padding.left + chartWidth}" y="${height - 5}" font-size="10" fill="#666" text-anchor="end">${maxDist.toFixed(1)} km</text>

                <!-- Y axis labels -->
                <text x="${padding.left - 5}" y="${padding.top + 5}" font-size="10" fill="#666" text-anchor="end">${maxEle.toFixed(0)}m</text>
                <text x="${padding.left - 5}" y="${height - padding.bottom}" font-size="10" fill="#666" text-anchor="end">${minEle.toFixed(0)}m</text>
            </svg>
        `;
    }

    /**
     * Show loading overlay
     */
    showLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        }
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }
}

// Create and export singleton instance
const uiControls = new UIControls();
export default uiControls;
