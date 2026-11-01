// Sources of the Altopiano delle Rocche region, in priority order (the
// cross-source dedupe prefers exact coordinates and more photos, not order).
//
// Not here, and why (checked Nov 2026):
// - Immobiliare.it, Idealista, Casa.it: DataDome bot wall on every page.
//   Idealista has an official API (api.idealista.com, key on request) —
//   the way in if a key is obtained.
// - Wikicasa, Gate-away, Properstar, Trovit/Mitula, Tempocasa: Cloudflare /
//   WAF challenges or 401/403 to scripted requests.
// - Subito.it: works, but its robots.txt forbids automated access.
import tecnocasa from './tecnocasa.mjs'
import pvp from './pvp.mjs'

export const SOURCES = [tecnocasa, pvp]
