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
   Ireland; **Rightmove**, **s1homes** and **TSPC** — the Scottish and
   Tayside solicitors' portals, whose listings are often absent from
   Rightmove — **ESPC**, the Edinburgh Solicitors Property Centre, whose
   East Lothian / East Fife / Perthshire / Argyll listings are marketed by
   solicitor-agents and often never reach Rightmove (JSON search API,
   detail page fetched only for new urls) — and **OnTheMarket**, whose
   "Only With Us" exclusives don't appear elsewhere, for Scotland/UK; TSPC
   covers the Angus coast: Arbroath, Carnoustie, Montrose and their coastal
   villages). Ireland: MyHome.ie for the Rosses (Burtonport zone, cap 60)
   plus the whole Donegal coast as the `Donegal (Irlanda)` extra zone
   (coastal town pages only — `countyPages: false` — cap 120). Daft.ie,
   Property.ie and Zoopla sit behind bot protection and cannot be fetched
   without a real browser; HSPC blocks scripted requests outright.
   The same house found on two portals is de-duplicated by address+price,
   price+coordinates, and address-prefix+coordinates (the last one catches a
   house dual-listed by two agents at different asking prices).
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

## Ad facts, backfill, travel time, trends

Every new listing carries, from its detail page, a ≤500-char excerpt of the
ad's own description (`desc`), the EPC letter (`energy`) and the council
tax band (`ctax`); older Rightmove/OnTheMarket listings catch up **80 a
day** (`BACKFILL` env var), marked with `enr` so nothing is fetched twice.
`travel` = `{g, min}` is the driving time from the nearest airport
(Edinburgh, Glasgow, Inverness, Aberdeen, Dublin, Donegal) via OSRM's table
service, computed once per house; the portal filters "≤ 1h30 / 2h30 / 4h"
and sorts on it. `scripts/trends.mjs` reads the daily snapshots of
`data.json` from git (checkout with `fetch-depth: 200`) and writes
`public/trends.json` (per day: totals, new, sold; per zone: count and
median asking in EUR) for the market-trends column of the stats panel.

## Bargain analysis (Occasioni)

After each refresh, `scripts/analyze-deals.mjs` scores every listing with
predefined checks — price per m² and absolute price vs zone medians,
tracked reductions, time on the portal, seller-motivation wording on the
source page (fixed price, closing date, no chain, quick sale), value-add
potential — and writes `public/deals.json`. A listing is a deal only with
a real price signal; tiers 💎 (45+) and 🔥 (60+). The portal shows them in
the 💎 Occasioni view with the full check breakdown, as a card badge, as a
filter chip, and in each deal's detail sheet.

## Cerca qui (user-requested areas)

Pan/zoom the map to any area and press **🤖 Trova nuove case qui**. The
request is a GitHub issue on this repo (title `Cerca qui: <place>`, label
`cerca-qui`) containing a JSON block with the map centre, zoom and bounds.
With the [Cloudflare Worker](cerca-qui-worker.md) configured the issue is
filed with one tap from the portal; otherwise the portal opens the prefilled
issue on GitHub to confirm by hand. On its next run the agent:

1. Reads every open `Cerca qui:` issue.
2. Scrapes real listings for that area from the right portals for the country
   (MyHome.ie for the Republic of Ireland; Rightmove, OnTheMarket and s1homes
   for the UK — the latter two tried dynamically on the locality names found
   in the area, and the slugs that answer are recorded in the zone config so
   the daily agent keeps querying every source), keeping only houses inside
   the requested map bounds.
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

## Analisi live (per casa, su richiesta)

The detail sheet's **Analisi live** button files an `Analizza:` issue via the
worker; `.github/workflows/analizza.yml` runs `scripts/analizza-live.mjs`
within a minute and posts the Italian markdown report as the issue comment
the portal polls for. Everything is computed from live sources — the agent
(Anthropic API → OpenAI → Copilot CLI fallback) only writes the verdict on
top of a JSON dossier of the numbers:

- **the ad page now**: price, price formula, tenure, council tax band (→
  estimated £/year), EPC (→ heating hint), real time on market, reductions,
  closing date / no chain / motivated-seller wording;
- **portal comparables** (same zone, same bedrooms, €/m²) with in-app links
  to cheaper alternatives;
- **prices actually paid** nearby from Rightmove house-prices (Registers of
  Scotland data): 800 m radius / 3 years with a full postcode, the outcode
  / 2 years otherwise; Ireland points to the Property Price Register;
- **rental market** on OnTheMarket (same town) → gross yield;
- a live **OnTheMarket second opinion** on asking prices;
- the **sold archive** within 8 km, interpreted (median days before a house
  disappears → fast/normal/slow market);
- **coast and elevation**: distance to the OSM coastline and the EU 25 m DEM
  elevation, with SEPA / Dynamic Coast (or OPW) links;
- purchase costs (LBTT + ADS, or Irish stamp duty);
- a deterministic **offer strategy** (opening and ceiling, each lever
  explained) that feeds the agent's verdict. Auction lots keep their own
  three-stage pipeline (dossier → indicators → verdict).
