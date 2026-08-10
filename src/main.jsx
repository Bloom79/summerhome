import React from 'react'
import ReactDOM from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.jsx'
import { LangProvider } from './i18n.jsx'

// Listings live in data.json, fetched at runtime: agents update the portal by
// publishing new data, with no app rebuild — and the app can hot-swap it.
fetch(`${import.meta.env.BASE_URL}data.json`, { cache: 'no-store' })
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
