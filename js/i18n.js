/**
 * i18n.js - Internationalization Module
 * =====================================
 * Handles language switching and translation lookups.
 */

class I18n {
    constructor() {
        this.currentLang = 'it';
        this.translations = {};
        this.listeners = [];
    }

    /**
     * Initialize the i18n system
     * @param {string} defaultLang - Default language code
     */
    async init(defaultLang = 'it') {
        // Check URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        const langParam = urlParams.get('lang');

        // Check localStorage
        const storedLang = localStorage.getItem('preferred_language');

        // Determine language to use
        this.currentLang = langParam || storedLang || defaultLang;

        // Load translations
        await this.loadLanguage('it');
        await this.loadLanguage('en');

        // Apply translations to DOM
        this.updateDOM();
    }

    /**
     * Load a language file
     * @param {string} lang - Language code
     */
    async loadLanguage(lang) {
        try {
            const response = await fetch(`lang/${lang}.json`);
            if (response.ok) {
                this.translations[lang] = await response.json();
            } else {
                console.warn(`Failed to load language file: ${lang}`);
            }
        } catch (error) {
            console.error(`Error loading language ${lang}:`, error);
        }
    }

    /**
     * Get translation for a key
     * @param {string} key - Translation key
     * @param {object} params - Optional parameters for interpolation
     * @returns {string} - Translated string
     */
    t(key, params = {}) {
        const langData = this.translations[this.currentLang] || this.translations['it'] || {};
        let text = langData[key] || key;

        // Simple parameter interpolation
        Object.keys(params).forEach(param => {
            text = text.replace(new RegExp(`{${param}}`, 'g'), params[param]);
        });

        return text;
    }

    /**
     * Get localized text from an object with language keys
     * @param {object|string} obj - Object with {it: ..., en: ...} or plain string
     * @returns {string} - Localized text
     */
    localize(obj) {
        if (typeof obj === 'string') {
            return obj;
        }
        if (obj && typeof obj === 'object') {
            return obj[this.currentLang] || obj['it'] || obj['en'] || '';
        }
        return '';
    }

    /**
     * Set the current language
     * @param {string} lang - Language code
     */
    setLanguage(lang) {
        if (this.translations[lang]) {
            this.currentLang = lang;
            localStorage.setItem('preferred_language', lang);
            this.updateURL();
            this.updateDOM();
            this.notifyListeners();
        }
    }

    /**
     * Get current language
     * @returns {string} - Current language code
     */
    getLanguage() {
        return this.currentLang;
    }

    /**
     * Update URL with language parameter
     */
    updateURL() {
        const url = new URL(window.location);
        url.searchParams.set('lang', this.currentLang);
        window.history.replaceState({}, '', url);
    }

    /**
     * Update DOM elements with data-i18n attribute
     */
    updateDOM() {
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = this.t(key);
            if (translation) {
                element.textContent = translation;
            }
        });

        // Update document title
        document.title = this.t('app_title');

        // Update language buttons
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === this.currentLang);
        });

        // Update document lang attribute
        document.documentElement.lang = this.currentLang;
    }

    /**
     * Add a language change listener
     * @param {function} callback - Callback function
     */
    onLanguageChange(callback) {
        this.listeners.push(callback);
    }

    /**
     * Remove a language change listener
     * @param {function} callback - Callback function to remove
     */
    offLanguageChange(callback) {
        this.listeners = this.listeners.filter(cb => cb !== callback);
    }

    /**
     * Notify all listeners of language change
     */
    notifyListeners() {
        this.listeners.forEach(callback => callback(this.currentLang));
    }
}

// Create and export singleton instance
const i18n = new I18n();
export default i18n;
export const t = (key, params) => i18n.t(key, params);
export const localize = (obj) => i18n.localize(obj);
