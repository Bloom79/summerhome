// URL of the deployed "Cerca qui" Cloudflare Worker (docs/cerca-qui-worker.md).
// When set, the map's agent request sends with one tap, no GitHub login.
// When '', the panel falls back to opening a prefilled GitHub issue.
export const CERCA_QUI_ENDPOINT = 'https://casatrova-cerca-qui.casatrova.workers.dev'

// Web-push VAPID public key — must match the worker's key pair.
export const VAPID_PUBLIC_KEY = 'BE5pp58OcGziWFz7UywR5__wvDSiP2i-BvveEQ-g2fSL6U9FgUP3crvCm7ZlB3J95GlKVC9htwL0i2nhefRS8pM'
