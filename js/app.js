/**
 * app.js - Main Application Module
 * ==================================
 * Entry point for the cycling routes map application.
 */

import i18n from './i18n.js';
import mapManager from './map.js';
import gpxLoader from './gpx-loader.js';
import poiManager from './poi-manager.js';
import uiControls from './ui-controls.js';
import { getRoutes } from './api.js';

/**
 * Main application class
 */
class App {
    constructor() {
        this.routes = [];
        this.initialized = false;
    }

    /**
     * Initialize the application
     */
    async init() {
        console.log('Initializing Cycling Routes Map...');

        try {
            // Show loading
            uiControls.showLoading();

            // Initialize i18n
            await i18n.init('it');
            console.log('i18n initialized');

            // Initialize map
            mapManager.init('map');
            console.log('Map initialized');

            // Load routes data
            this.routes = await getRoutes();
            console.log(`Loaded ${this.routes.length} routes`);

            // Load and render GPX files
            const loadPromises = this.routes.map(route => gpxLoader.loadRoute(route));
            const loadedRoutes = await Promise.all(loadPromises);
            const successfulRoutes = loadedRoutes.filter(r => r !== null);
            console.log(`Rendered ${successfulRoutes.length} routes`);

            // Initialize POI
            await poiManager.init();
            console.log('POI initialized');

            // Initialize UI controls
            uiControls.init(this.routes);
            console.log('UI controls initialized');

            // Fit map to all routes
            if (successfulRoutes.length > 0) {
                mapManager.fitToRoutes(successfulRoutes);
            }

            // Hide loading
            uiControls.hideLoading();

            this.initialized = true;
            console.log('Application initialized successfully');

        } catch (error) {
            console.error('Failed to initialize application:', error);
            uiControls.hideLoading();
            this.showError('Failed to load application. Please refresh the page.');
        }
    }

    /**
     * Show error message to user
     * @param {string} message - Error message
     */
    showError(message) {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            overlay.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <p style="color: #E63946; margin-bottom: 10px;">${message}</p>
                    <button onclick="location.reload()" style="
                        padding: 10px 20px;
                        background: #2A9D8F;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    ">Reload</button>
                </div>
            `;
            overlay.classList.remove('hidden');
        }
    }

    /**
     * Get all routes
     * @returns {Array} - All routes
     */
    getRoutes() {
        return this.routes;
    }

    /**
     * Check if app is initialized
     * @returns {boolean} - Initialization state
     */
    isInitialized() {
        return this.initialized;
    }
}

// Create app instance
const app = new App();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}

// Export for debugging
window.cyclingRoutesApp = {
    app,
    mapManager,
    gpxLoader,
    poiManager,
    uiControls,
    i18n
};

export default app;
