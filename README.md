# summerhome — CasaTrova

**CasaTrova** is a single-page real-estate search portal: an interactive map,
precise geolocation, advanced filters, and photo previews for property
listings. It's a fully static app (plain HTML/CSS/JS) using
[Leaflet](https://leafletjs.com/) for the map and OpenStreetMap / Nominatim
for tiles and geocoding — no build step and no backend required.

## Live site

The app is deployed to **GitHub Pages** via the workflow in
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Every push to
the deploy branch publishes the latest `index.html`.

## Run locally

Because everything is static, just open `index.html` in a browser, or serve
the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Notes

- The listings in `index.html` are demonstration data with real coordinates,
  ready to be wired up to a real data source.
- All map/geocoding requests go to public OpenStreetMap services; no API key
  is needed.
