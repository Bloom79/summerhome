import React from 'react'
import ReactDOM from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.jsx'
import { LangProvider } from './i18n.jsx'
import { dataUrl } from './region.js'

// Listings live in data.json, fetched at runtime: agents update the portal by
// publishing new data, with no app rebuild — and the app can hot-swap it.
fetch(dataUrl('data.json'), { cache: 'no-store' })
  .then((r) => r.json())
  .then((db) => {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <LangProvider>
          <App initialDb={db} />
        </LangProvider>
      </React.StrictMode>
    )
  })
  .catch(() => {
    document.getElementById('root').innerHTML =
      '<p style="padding:40px;text-align:center;font-family:sans-serif">Errore nel caricamento dei dati — riprova tra qualche istante.</p>'
  })

// New deploys reach long-lived pages too: the Android app keeps its WebView
// alive in the background for days, so "reopening" it never reloaded the
// site. When the page comes back to the foreground (and every 30 minutes),
// compare the bundle it runs with the one the live index.html points to.
const runningBundle = [...document.scripts].map((s) => s.src).find((s) => /\/assets\/index-[\w-]+\.js/.test(s))
const checkForUpdate = async () => {
  if (!runningBundle) return // dev server: nothing to compare
  try {
    const html = await (await fetch(`${import.meta.env.BASE_URL}?v=${Date.now()}`, { cache: 'no-store' })).text()
    const live = (/\/assets\/index-[\w-]+\.js/.exec(html) || [])[0]
    if (live && !runningBundle.endsWith(live)) location.reload()
  } catch { /* offline: try again next time */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate() })
setInterval(checkForUpdate, 30 * 60e3)
