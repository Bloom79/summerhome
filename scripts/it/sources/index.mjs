// Sources of the Altopiano delle Rocche region. Order doesn't matter: the
// cross-source dedupe keeps the copy with exact coordinates and more photos.
//
// Not here, and why (checked Nov 2026):
// - Immobiliare.it, Idealista, Casa.it: DataDome bot wall on every page.
//   Idealista has an official API (api.idealista.com, key on request) —
//   the way in if a key is obtained.
// - Wikicasa, Gate-away, Properstar, Trovit/Mitula, Tempocasa: Cloudflare /
//   WAF challenges or 401/403 to scripted requests.
import tecnocasa from './tecnocasa.mjs'
import subito from './subito.mjs'
import altopiano from './altopiano.mjs'
import pvp from './pvp.mjs'

export const SOURCES = [tecnocasa, subito, altopiano, pvp]
