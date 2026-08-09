# summerhome — CasaTrova

**CasaTrova** is a coastal-property search portal built as a **React + Vite**
single-page app: an interactive Leaflet map, precise geolocation, advanced
filters, favourites, and a photo gallery for each property. It uses
OpenStreetMap tiles and the Nominatim geocoder — no API key and no backend
required.

## Focus areas

The portal covers **only** these coastal areas (nothing else):

| Zone | Region | Currency |
|------|--------|----------|
| **Burtonport / The Rosses** | Co. Donegal, Ireland | € EUR |
| **North Berwick** (& Gullane, Dirleton) | East Lothian, Scotland | £ GBP |
| **Rosemarkie / Fortrose** | Black Isle, Highland, Scotland | £ GBP |
| **East Neuk of Fife** (Anstruther, Crail, Pittenweem, St Monans, Elie) | Fife, Scotland | £ GBP |

## Daily update agent

Listings are refreshed **every day by a scheduled agent** that searches these
four areas and commits the new data to `src/data.js` (updating `LAST_UPDATED`).
The push triggers the Pages workflow, so the live site always reflects the
latest run. See [`docs/daily-agent.md`](docs/daily-agent.md) for the agent's
brief and how to change/pause it.

## Tech stack

- [React 18](https://react.dev/) + [Vite 5](https://vite.dev/) (build tooling)
- [Leaflet](https://leafletjs.com/) via
  [react-leaflet](https://react-leaflet.js.org/) for the interactive map
- OpenStreetMap tiles + Nominatim geocoding

## Project structure

```
index.html            # Vite entry
src/
  main.jsx            # React bootstrap
  App.jsx             # State + filtering logic
  data.js             # Demo listings (real coordinates)
  utils.js            # Formatting, distance, geocoding helpers
  index.css           # Styles
  components/
    Header.jsx        # Search (autocomplete) + "near me"
    Filters.jsx       # Filter bar + advanced drawer
    ListPanel.jsx     # Results panel
    Card.jsx          # Listing card
    MapPanel.jsx      # Leaflet map + price-pin markers
    DetailModal.jsx   # Property detail + gallery
```

## Develop

```bash
npm install
npm run dev       # start the dev server
npm run build     # production build → dist/
npm run preview   # preview the production build
```

## Deployment

Deployed to **GitHub Pages** via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): every push to
the deploy branch builds the app and publishes `dist/`. The Vite `base` is set
to `/summerhome/` to match the Pages URL:

**https://bloom79.github.io/summerhome/**

> First-time setup: in the repository **Settings → Pages**, set
> **Source** to **GitHub Actions** (one time). After that the workflow deploys
> automatically.

## Notes

- Listings in `src/data.js` are demonstration data with real coordinates,
  ready to be wired up to a real data source / API.
