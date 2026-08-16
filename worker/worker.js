// CasaTrova worker — the portal's tiny backend on Cloudflare.
//
// Roles:
//  1. POST /            file a "Cerca qui:" request issue (map button)
//  2. GET  /status      live progress of a request (portal status widget)
//  3. POST /subscribe   store a push subscription + its alert filters (KV)
//  4. POST /unsubscribe remove a subscription
//  5. POST /check       diff data.json vs the stored snapshot and push
//                       matching notifications (also runs on a cron)
//
// Secrets: GITHUB_TOKEN (issues r/w), VAPID_PRIVATE_KEY. Vars: VAPID_PUBLIC_KEY.
// KV: ALERTS — sub:<sha256(endpoint)> records, plus snapshot/lastcheck.

import { buildPushPayload } from '@block65/webcrypto-web-push'

const REPO = 'Bloom79/summerhome'
const RAW_DATA = 'https://raw.githubusercontent.com/Bloom79/summerhome/main/public/data.json'
const PORTAL = 'https://bloom79.github.io/summerhome/'
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

const sha256hex = async (s) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Mirrors the portal's alert matching — keep the two in sync.
const matchListing = (l, a) =>
  (!a.zone || l.zone === a.zone) &&
  (a.priceMax == null || l.price <= a.priceMax) &&
  (a.priceMin == null || l.price >= a.priceMin) &&
  (!a.rooms || (l.rooms || 0) >= a.rooms) &&
  (!a.seaView || !!l.seaView) &&
  (!a.garden || (l.feats || []).includes('Giardino'))

const EV_KEY = { nuova: 'nuove', ribasso: 'ribassi', venduta: 'vendute' }

async function runCheck(env) {
  const now = Date.now()
  const last = +((await env.ALERTS.get('lastcheck')) || 0)
  if (now - last < 60e3) return { skipped: 'throttled' }
  await env.ALERTS.put('lastcheck', String(now))

  const db = await (await fetch(`${RAW_DATA}?t=${now}`)).json()
  const cur = {}
  for (const l of db.listings || [])
    cur[l.url] = { price: l.price, zone: l.zone, rooms: l.rooms, seaView: !!l.seaView, feats: l.feats || [], addr: l.addr, currency: l.currency }
  const soldUrls = (db.sold || []).map((s) => s.url).filter(Boolean)

  const snapRaw = await env.ALERTS.get('snapshot')
  await env.ALERTS.put('snapshot', JSON.stringify({ listings: cur, soldUrls }))
  if (!snapRaw) return { first: true, listings: Object.keys(cur).length }
  const snap = JSON.parse(snapRaw)

  const events = []
  for (const [url, l] of Object.entries(cur)) {
    const old = snap.listings[url]
    if (!old) events.push({ type: 'nuova', l: { ...l, url } })
    else if (l.price < old.price) events.push({ type: 'ribasso', l: { ...l, url }, oldPrice: old.price })
  }
  const oldSold = new Set(snap.soldUrls || [])
  for (const u of soldUrls)
    if (!oldSold.has(u) && snap.listings[u]) events.push({ type: 'venduta', l: { ...snap.listings[u], url: u } })
  if (!events.length) return { events: 0 }

  const vapid = { subject: 'mailto:dedalus79@gmail.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  const subs = await env.ALERTS.list({ prefix: 'sub:' })
  let sent = 0
  for (const k of subs.keys) {
    const rec = JSON.parse((await env.ALERTS.get(k.name)) || 'null')
    if (!rec?.subscription) continue
    const hits = []
    for (const ev of events)
      if ((rec.alerts || []).some((a) => a.ev?.[EV_KEY[ev.type]] && matchListing(ev.l, a))) hits.push(ev)
    if (!hits.length) continue
    const fmt = (l) => `${(l.addr || '').split(',')[0]} ${l.currency === 'EUR' ? '€' : '£'}${Math.round(l.price / 1000)}k`
    const by = (t) => hits.filter((h) => h.type === t)
    const parts = []
    if (by('nuova').length) parts.push(`🏠 ${by('nuova').length} nuove: ${by('nuova').slice(0, 3).map((h) => fmt(h.l)).join(', ')}`)
    if (by('ribasso').length) parts.push(`📉 ${by('ribasso').length} ribassi: ${by('ribasso').slice(0, 3).map((h) => `${fmt(h.l)} (era ${Math.round(h.oldPrice / 1000)}k)`).join(', ')}`)
    if (by('venduta').length) parts.push(`🔴 ${by('venduta').length} vendute/ritirate`)
    const msg = {
      data: JSON.stringify({ title: 'CasaTrova 🔔 novità per i tuoi avvisi', body: parts.join(' · '), url: PORTAL }),
      options: { ttl: 86400 },
    }
    try {
      const payload = await buildPushPayload(msg, rec.subscription, vapid)
      const res = await fetch(rec.subscription.endpoint, payload)
      if (res.status === 404 || res.status === 410) await env.ALERTS.delete(k.name)
      else if (res.status < 300) sent++
    } catch { /* transient push failure: keep the subscription */ }
  }
  return { events: events.length, sent }
}

export default {
  async scheduled(event, env) {
    await runCheck(env)
  },

  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    const u = new URL(request.url)

    const gh = (path, init = {}) =>
      fetch('https://api.github.com' + path, {
        ...init,
        headers: {
          Authorization: 'Bearer ' + env.GITHUB_TOKEN,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'casatrova-cerca-qui-worker',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      })

    // GET /sync?code=X — download a device-sync snapshot.
    if (request.method === 'GET' && u.pathname === '/sync') {
      const code = (u.searchParams.get('code') || '').toUpperCase()
      if (!/^[A-Z0-9]{6,12}$/.test(code)) return json({ error: 'invalid code' }, 400, cors)
      const rec = await env.ALERTS.get('sync:' + code)
      if (!rec) return json({ error: 'not found' }, 404, cors)
      return json({ ok: true, data: JSON.parse(rec) }, 200, { ...cors, 'Cache-Control': 'no-store' })
    }

    // POST /sync — upload {code, data} (favourites/notes/alerts snapshot).
    if (request.method === 'POST' && u.pathname === '/sync') {
      let body
      try { body = await request.json() } catch { return json({ error: 'invalid JSON' }, 400, cors) }
      const code = (body?.code || '').toUpperCase()
      if (!/^[A-Z0-9]{6,12}$/.test(code)) return json({ error: 'invalid code' }, 400, cors)
      const data = JSON.stringify(body.data || {})
      if (data.length > 64e3) return json({ error: 'too large' }, 413, cors)
      await env.ALERTS.put('sync:' + code, data, { expirationTtl: 90 * 86400 })
      return json({ ok: true }, 200, cors)
    }

    // GET /status?issue=N — live progress for the portal's status widget.
    if (request.method === 'GET') {
      if (u.pathname !== '/status') return json({ error: 'not found' }, 404, cors)
      const n = +u.searchParams.get('issue')
      if (!n) return json({ error: 'issue param required' }, 400, cors)
      const r = await gh(`/repos/${REPO}/issues/${n}`)
      if (!r.ok) return json({ error: 'github ' + r.status }, 502, cors)
      const it = await r.json()
      let outcome = null, zone = null, added = null
      if (it.comments > 0) {
        const cr = await gh(`/repos/${REPO}/issues/${n}/comments`)
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
      return json({ state: it.state, outcome, zone, added }, 200, { ...cors, 'Cache-Control': 'no-store' })
    }

    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors)

    // POST /check — recompute the diff and push matching notifications.
    // Self-sourcing (reads the repo's own data.json) and throttled, so it
    // needs no auth: the worst an abuser can trigger is a no-op.
    if (u.pathname === '/check') return json(await runCheck(env), 200, cors)

    // POST /subscribe — store {subscription, alerts[]}.
    if (u.pathname === '/subscribe') {
      let body
      try { body = await request.json() } catch { return json({ error: 'invalid JSON' }, 400, cors) }
      const s = body?.subscription
      if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth || !/^https:\/\//.test(s.endpoint))
        return json({ error: 'invalid subscription' }, 400, cors)
      const alerts = (Array.isArray(body.alerts) ? body.alerts : []).slice(0, 20)
      const key = 'sub:' + (await sha256hex(s.endpoint))
      if (!alerts.length) { await env.ALERTS.delete(key); return json({ ok: true, removed: true }, 200, cors) }
      await env.ALERTS.put(key, JSON.stringify({ subscription: s, alerts, ts: Date.now() }))
      return json({ ok: true, alerts: alerts.length }, 200, cors)
    }

    // POST /test-push — {endpoint}: send a test notification to that
    // subscription so the user can verify delivery. Endpoints are
    // unguessable, so knowing one is proof of ownership.
    if (u.pathname === '/test-push') {
      let body
      try { body = await request.json() } catch { return json({ error: 'invalid JSON' }, 400, cors) }
      if (!body?.endpoint) return json({ error: 'endpoint required' }, 400, cors)
      const rec = JSON.parse((await env.ALERTS.get('sub:' + (await sha256hex(body.endpoint)))) || 'null')
      if (!rec?.subscription) return json({ error: 'not subscribed' }, 404, cors)
      const vapid = { subject: 'mailto:dedalus79@gmail.com', publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
      const msg = {
        data: JSON.stringify({ title: 'CasaTrova 🔔', body: 'Notifica di prova: gli avvisi funzionano ✅', url: PORTAL }),
        options: { ttl: 600 },
      }
      try {
        const payload = await buildPushPayload(msg, rec.subscription, vapid)
        const res = await fetch(rec.subscription.endpoint, payload)
        return json({ ok: res.status < 300, status: res.status }, 200, cors)
      } catch (e) {
        return json({ ok: false, error: String(e && e.message || e) }, 200, cors)
      }
    }

    // POST /unsubscribe — {endpoint}.
    if (u.pathname === '/unsubscribe') {
      let body
      try { body = await request.json() } catch { return json({ error: 'invalid JSON' }, 400, cors) }
      if (!body?.endpoint) return json({ error: 'endpoint required' }, 400, cors)
      await env.ALERTS.delete('sub:' + (await sha256hex(body.endpoint)))
      return json({ ok: true }, 200, cors)
    }

    if (u.pathname !== '/') return json({ error: 'not found' }, 404, cors)

    // POST / — file a "Cerca qui" request as a GitHub issue.
    let req
    try { req = await request.json() } catch { return json({ error: 'invalid JSON' }, 400, cors) }
    const { place, lat, lng, zoom, bounds } = req || {}
    const num = (v) => typeof v === 'number' && Number.isFinite(v)
    if (!num(lat) || !num(lng) || lat < BOX.latMin || lat > BOX.latMax || lng < BOX.lngMin || lng > BOX.lngMax)
      return json({ error: 'coordinates outside UK/Ireland' }, 400, cors)
    if (!num(zoom) || zoom < 9) return json({ error: 'zoom in first' }, 400, cors)
    if (!bounds || !num(bounds.north) || !num(bounds.south) || !num(bounds.east) || !num(bounds.west))
      return json({ error: 'missing bounds' }, 400, cors)

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
