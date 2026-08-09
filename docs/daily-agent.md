# Daily listings agent

A scheduled agent refreshes the portal's property listings once per day, for
**only** these coastal areas:

- **Burtonport / The Rosses** — Co. Donegal, Ireland (prices in **EUR**)
- **North Berwick** (incl. Gullane, Dirleton) — East Lothian, Scotland (**GBP**)
- **Rosemarkie / Fortrose** — Black Isle, Highland, Scotland (**GBP**)
- **East Neuk of Fife** — Anstruther, Crail, Pittenweem, St Monans, Elie (**GBP**)

## What the agent does on each run

1. Searches current for-sale / to-let property listings in the four areas above,
   using public sources (e.g. **Daft.ie** for Donegal; **Rightmove / ESPC /
   Zoopla** for the Scottish villages).
2. Extracts structured data for each property: title, type, contract
   (`sale`/`rent`), `price`, `currency` (`EUR` for Ireland, `GBP` for Scotland),
   `size` (m² when available), rooms, baths, `zone`, `town`, address,
   latitude/longitude (geocoded), a short description, and — when available — a
   `url` back to the source listing.
3. Rewrites the `LISTINGS` array in [`../src/data.js`](../src/data.js) with the
   fresh results (keeping only the four zones) and sets `LAST_UPDATED` to the
   run date. It keeps the exported `IMGS`, `FEATURES`, and `ZONES`.
4. Runs `npm ci && npm run build` to confirm the app still compiles.
5. Commits and pushes to `main`, which triggers the GitHub Pages deploy so the
   live site updates automatically.
6. If a source can't be fetched for a zone, it keeps that zone's previous
   listings rather than emptying it, and makes no commit if nothing changed.

## Schedule

Runs daily at **06:00 UTC** (≈ 08:00 Europe/Rome in summer). Each run starts a
fresh agent session on this repository.

## Managing the agent

The agent is a **Claude Code Routine** (scheduled trigger). To change the time,
pause, or remove it, ask Claude to *update / disable / delete the "CasaTrova
daily listings agent" routine*, or manage it from the Claude Code triggers UI.

## Data contract (`src/data.js`)

Each listing object:

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
