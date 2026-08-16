# Daily listings agent

A scheduled agent refreshes the portal's property listings once per day, for
the built-in coastal areas below **plus any area requested from the map with
the "Trova nuove case qui" button** (see [Cerca qui](#cerca-qui-user-requested-areas)):

- **Burtonport / The Rosses** — Co. Donegal, Ireland (prices in **EUR**)
- **North Berwick** (incl. Gullane, Dirleton) — East Lothian, Scotland (**GBP**)
- **Rosemarkie / Fortrose** — Black Isle, Highland, Scotland (**GBP**)
- **East Neuk of Fife** — Anstruther, Crail, Pittenweem, St Monans, Elie (**GBP**)

## What the agent does on each run

1. Searches current for-sale / to-let property listings in the monitored areas
   (built-in + user-requested), using public sources (**MyHome.ie** for
   Ireland; **Rightmove** and **s1homes** — the Scottish solicitors' portal,
   whose listings are often absent from Rightmove — for Scotland/UK).
2. Extracts structured data for each property: title, type, contract
   (`sale`/`rent`), `price`, `currency` (`EUR` for Ireland, `GBP` for Scotland),
   `size` (m² when available), rooms, baths, `zone`, `town`, address,
   latitude/longitude (geocoded), a short description, and — when available — a
   `url` back to the source listing.
3. Rewrites the listings in [`../public/data.json`](../public/data.json) with the
   fresh results (keeping only the monitored zones) and sets `updated` to the
   run date. It keeps `features`, `zones`, and `sold`. The app fetches this
   file at runtime, so data updates need no rebuild.
4. Runs `node scripts/validate-data.mjs --spot-check 3` (quality gate: valid
   coordinates, real source urls, no duplicates, live spot-checks) and fixes
   anything it reports; the deploy workflow runs the same gate and refuses
   bad data. Then `npm ci && npm run build` to confirm the app compiles.
5. Commits and pushes to `main`, which triggers the GitHub Pages deploy so the
   live site updates automatically.
6. If a source can't be fetched for a zone, it keeps that zone's previous
   listings rather than emptying it, and makes no commit if nothing changed.

## Cerca qui (user-requested areas)

Pan/zoom the map to any area and press **🤖 Trova nuove case qui**. The
request is a GitHub issue on this repo (title `Cerca qui: <place>`, label
`cerca-qui`) containing a JSON block with the map centre, zoom and bounds.
With the [Cloudflare Worker](cerca-qui-worker.md) configured the issue is
filed with one tap from the portal; otherwise the portal opens the prefilled
issue on GitHub to confirm by hand. On its next run the agent:

1. Reads every open `Cerca qui:` issue.
2. Scrapes real listings for that area from the right portal for the country
   (MyHome.ie for the Republic of Ireland, Rightmove for the UK), keeping only
   houses inside the requested map bounds.
3. Adds the area as a new zone in `src/data.js` and records its search config
   in [`extra-zones.json`](extra-zones.json), so every future daily run keeps
   refreshing it like the built-in zones.
4. Closes the issue with a comment saying how many houses were added (or that
   nothing is for sale there right now).

## Schedule

Runs daily at **06:00 UTC** (≈ 08:00 Europe/Rome in summer). Each run starts a
fresh agent session on this repository.

## Managing the agent

The agent is a **Claude Code Routine** (scheduled trigger). To change the time,
pause, or remove it, ask Claude to *update / disable / delete the "CasaTrova
daily listings agent" routine*, or manage it from the Claude Code triggers UI.

## Data contract (`public/data.json`)

`{updated, zones, features, sold, listings}` — each listing object:

```js
{
  id, title, type, contract,          // 'sale' | 'rent'
  price, currency,                     // 'EUR' | 'GBP'
  size, rooms, baths, floor, year, energy,
  zone,                                // must be one of ZONES
  town, addr, lat, lng,
  imgs, feats, desc, date,             // date = 'YYYY-MM-DD'
  url,                                 // optional: source listing
}
```
