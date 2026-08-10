// CasaTrova "Cerca qui" endpoint — Cloudflare Worker.
//
// The portal is a static GitHub Pages site, so it has no credentials: this
// worker is the one place that holds a GitHub token (secret GITHUB_TOKEN) and
// turns a one-tap request from the map into the "Cerca qui:" issue that the
// daily agent reads. See docs/cerca-qui-worker.md for setup.

const REPO = 'Bloom79/summerhome'
const ALLOWED_ORIGINS = [
  'https://bloom79.github.io',
  'http://localhost:5173', // vite dev
  'http://localhost:4173', // vite preview
]
// UK + Ireland bounding box — same rule the agent applies to listings.
const BOX = { latMin: 49.5, latMax: 61.2, lngMin: -11.5, lngMax: 1.9 }

const json = (data, status, cors) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const ghAuth = (path, init = {}) =>
      fetch('https://api.github.com' + path, {
        ...init,
        headers: {
          Authorization: 'Bearer ' + env.GITHUB_TOKEN,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'casatrova-cerca-qui-worker',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      })

    // GET /status?issue=N — live progress for the portal's status widget.
    // Uses the worker's token, so the portal never hits GitHub's anonymous
    // rate limit. Outcome is derived from the workflow's closing comment.
    if (request.method === 'GET') {
      const u = new URL(request.url)
      if (u.pathname !== '/status') return json({ error: 'not found' }, 404, cors)
      const n = +u.searchParams.get('issue')
      if (!n) return json({ error: 'issue param required' }, 400, cors)
      const r = await ghAuth(`/repos/${REPO}/issues/${n}`)
      if (!r.ok) return json({ error: 'github ' + r.status }, 502, cors)
      const it = await r.json()
      let outcome = null, zone = null, added = null
      if (it.comments > 0) {
        const cr = await ghAuth(`/repos/${REPO}/issues/${n}/comments`)
        if (cr.ok) {
          const cs = await cr.json()
          const last = (cs[cs.length - 1] || {}).body || ''
          zone = (/Zona \*\*(.+?)\*\*/.exec(last) || [])[1] || null
          added = +((/\*\*(\d+) case\*\*/.exec(last) || [])[1] || 0) || null
          if (/aggiunta al portale/i.test(last)) outcome = 'ok'
          else if (/Nessuna zona aggiunta/i.test(last)) outcome = 'none'
          else if (/agente giornaliero/i.test(last)) outcome = 'deferred'
        }
      }
      if (!outcome && it.state === 'closed') outcome = 'ok'
      return json({ state: it.state, outcome, zone, added }, 200, {
        ...cors, 'Cache-Control': 'no-store',
      })
    }

    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors)

    let req
    try { req = await request.json() } catch { return json({ error: 'invalid JSON' }, 400, cors) }
    const { place, lat, lng, zoom, bounds } = req || {}
    const num = (v) => typeof v === 'number' && Number.isFinite(v)
    if (!num(lat) || !num(lng) || lat < BOX.latMin || lat > BOX.latMax || lng < BOX.lngMin || lng > BOX.lngMax)
      return json({ error: 'coordinates outside UK/Ireland' }, 400, cors)
    if (!num(zoom) || zoom < 9) return json({ error: 'zoom in first' }, 400, cors)
    if (!bounds || !num(bounds.north) || !num(bounds.south) || !num(bounds.east) || !num(bounds.west))
      return json({ error: 'missing bounds' }, 400, cors)

    const gh = ghAuth

    // Dedupe: an open request within ~3 km of this point is the same request.
    const listRes = await gh(`/repos/${REPO}/issues?state=open&per_page=50`)
    if (listRes.ok) {
      for (const it of await listRes.json()) {
        if (!it.title || !it.title.startsWith('Cerca qui:')) continue
        const m = /"lat":\s*(-?[\d.]+),\s*"lng":\s*(-?[\d.]+)/.exec(it.body || '')
        if (m && Math.abs(+m[1] - lat) < 0.03 && Math.abs(+m[2] - lng) < 0.05)
          return json({ ok: true, duplicate: true, issueUrl: it.html_url }, 200, cors)
      }
    }

    const clean = {
      place: typeof place === 'string' && place.trim() ? place.trim().slice(0, 80) : null,
      lat: +lat.toFixed(5), lng: +lng.toFixed(5), zoom: Math.round(zoom),
      bounds: {
        north: +bounds.north.toFixed(5), south: +bounds.south.toFixed(5),
        east: +bounds.east.toFixed(5), west: +bounds.west.toFixed(5),
      },
    }
    const title = `Cerca qui: ${clean.place || `${clean.lat}, ${clean.lng}`}`
    const body = [
      'Richiesta **"Cerca qui"** inviata dal portale CasaTrova: aggiungere annunci in quest\'area della mappa.',
      '',
      '```json',
      JSON.stringify(clean, null, 2),
      '```',
      '',
      '_Gestita dall\'agente giornaliero: definisce la zona, cerca gli annunci sui portali del paese giusto, li aggiunge al portale e chiude questa issue._',
    ].join('\n')

    let res = await gh(`/repos/${REPO}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body, labels: ['cerca-qui'] }),
    })
    if (res.status === 422) {
      // Label problems must not block the request; the agent matches by title.
      res = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: JSON.stringify({ title, body }) })
    }
    if (!res.ok) return json({ error: 'github ' + res.status }, 502, cors)
    const issue = await res.json()
    return json({ ok: true, issueUrl: issue.html_url }, 200, cors)
  },
}
