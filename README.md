# Mappa Percorsi Ciclistici - Basso Lago di Garda

Interactive web map for cycling routes in the southern Lake Garda area, featuring surface type visualization, points of interest, and multi-language support.

## Features

- **Interactive Map**: OpenStreetMap-based map with Leaflet.js
- **Surface Visualization**: Routes displayed with different styles based on surface type:
  - Solid line for asphalt
  - Dashed line for unpaved/gravel
  - Double line for trails
- **Points of Interest**: Start points, viewpoints, fountains, restaurants, and bike services
- **Filtering**: Filter routes by surface type
- **Multi-language**: Italian and English support
- **Responsive Design**: Works on desktop, tablet, and mobile
- **URL Sharing**: Shareable URLs with route selection and map position

## Project Structure

```
/
├── index.html              # Main HTML file
├── css/
│   └── style.css           # Styles
├── js/
│   ├── app.js              # Main application
│   ├── map.js              # Map management
│   ├── gpx-loader.js       # GPX loading and rendering
│   ├── poi-manager.js      # Points of interest
│   ├── ui-controls.js      # UI interactions
│   ├── i18n.js             # Internationalization
│   └── api.js              # Data fetching
├── data/
│   ├── routes.json         # Route metadata
│   ├── poi.json            # Points of interest
│   └── gpx/                # GPX track files
├── icons/                  # SVG icons for POI
├── lang/                   # Translation files
│   ├── it.json
│   └── en.json
└── tools/
    └── surface_analyzer.py # Python script for surface analysis
```

## Quick Start

### Running Locally

1. Clone the repository
2. Serve the files with a local web server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve

# Using PHP
php -S localhost:8000
```

3. Open `http://localhost:8000` in your browser

### Adding New Routes

1. Add your GPX file to `data/gpx/`
2. Run the surface analyzer to classify surfaces:

```bash
cd tools
python surface_analyzer.py
```

3. The script will update `data/routes.json` with surface data

## Surface Analyzer

The Python script `tools/surface_analyzer.py` analyzes GPX tracks and classifies road surfaces using OpenStreetMap data via Overpass API.

### Requirements

- Python 3.6+
- No external dependencies (uses standard library)

### Usage

```bash
# Analyze all GPX files
python surface_analyzer.py

# Force reprocessing (ignore cache)
python surface_analyzer.py --force

# Verbose output
python surface_analyzer.py --verbose

# Dry run (don't update routes.json)
python surface_analyzer.py --dry-run
```

### Surface Classification

The script classifies surfaces into three categories:

| Category | Surface Tags | Highway Types |
|----------|-------------|---------------|
| Asphalt | asphalt, paved, concrete, paving_stones | primary, secondary, tertiary, residential, cycleway |
| Unpaved | gravel, fine_gravel, compacted, dirt, earth | track |
| Trail | grass, sand, mud, woodchips | path, footway, bridleway |

## Data Format

### routes.json

```json
{
  "routes": [
    {
      "id": "percorso-001",
      "nome": {
        "it": "Nome Italiano",
        "en": "English Name"
      },
      "file_gpx": "percorso-001.gpx",
      "colore": "#E63946",
      "distanza_km": 32.5,
      "dislivello_positivo": 450,
      "stats_fondo": {
        "asfalto_percent": 65,
        "sterrato_percent": 25,
        "sentiero_percent": 10
      },
      "segmenti": [
        {
          "da_indice": 0,
          "a_indice": 45,
          "tipo_fondo": "asphalt"
        }
      ],
      "info_extra": {
        "difficolta": "media",
        "tempo_stimato": "2h 30min",
        "nota": {
          "it": "Note in italiano",
          "en": "Notes in English"
        }
      }
    }
  ]
}
```

### poi.json

```json
{
  "poi": [
    {
      "id": "poi-001",
      "nome": {
        "it": "Nome POI",
        "en": "POI Name"
      },
      "tipo": "fontana",
      "coordinate": [45.1234, 10.5678],
      "nota": {
        "it": "Descrizione",
        "en": "Description"
      }
    }
  ]
}
```

POI types: `partenza_arrivo`, `vista`, `fontana`, `ristoro`, `bike_service`

## URL Parameters

The application supports URL parameters for sharing:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `route` | Pre-select a route | `?route=percorso-001` |
| `lat` | Map center latitude | `?lat=45.48` |
| `lng` | Map center longitude | `?lng=10.68` |
| `zoom` | Map zoom level | `?zoom=13` |
| `lang` | Interface language | `?lang=en` |

Example: `https://example.com/?route=percorso-001&lang=en`

## Adding Translations

1. Create a new language file in `lang/` (e.g., `lang/de.json`)
2. Copy the structure from `lang/en.json`
3. Translate all values
4. Add a language button in `index.html`

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome for Android)

## Dependencies

All dependencies are loaded from CDN:

- [Leaflet](https://leafletjs.com/) - Map library
- [Leaflet GPX](https://github.com/mpetazzoni/leaflet-gpx) - GPX parsing
- [Leaflet MarkerCluster](https://github.com/Leaflet/Leaflet.markercluster) - POI clustering
- [Leaflet Elevation](https://github.com/Raruto/leaflet-elevation) - Elevation profile
- [Leaflet PolylineOffset](https://github.com/bbecquet/Leaflet.PolylineOffset) - Overlapping routes

## Future Improvements

The code is structured for future backend integration:

1. Set `API_BASE` in `js/api.js` to your API URL
2. Implement API endpoints:
   - `GET /api/routes` - List routes with filtering
   - `GET /api/poi` - List points of interest
   - `GET /api/gpx/:filename` - Get GPX file
   - `POST /api/recommend` - Route recommendation

## License

MIT License

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request
