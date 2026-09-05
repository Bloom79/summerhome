import { useEffect, useRef, useState } from 'react'
import { geocode, zoomForType, fmtP } from '../utils.js'
import { useI18n } from '../i18n.jsx'

export default function Header({ listings, gbpEur, onOpenListing, onFlyTo, onNearMe, onOpenStats, onOpenHome, newCount, onToggleDeals, dealsActive, dealsCount, onOpenSync, deskView, onDeskView, toast }) {
  const { t, lang, setLang, eur, setEur } = useI18n()
  const fx = eur ? gbpEur : null
  const toggleEur = () => {
    const next = !eur
    setEur(next)
    toast(next ? t('eur_on', { fx: gbpEur ? gbpEur.toFixed(3) : '—' }) : t('eur_off'))
  }
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [local, setLocal] = useState([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const debRef = useRef(null)

  // Close suggestions when clicking outside the search area.
  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  // Instant matches among the portal's own listings (address/town/zone).
  const matchListings = (q) => {
    const s = q.toLowerCase()
    return listings
      .filter((l) => `${l.addr} ${l.town} ${l.zone}`.toLowerCase().includes(s))
      .slice(0, 5)
  }

  const onInput = (e) => {
    const v = e.target.value
    setValue(v)
    clearTimeout(debRef.current)
    if (v.trim().length < 3) {
      setSuggestions([]); setLocal([]); setOpen(false)
      return
    }
    const loc = matchListings(v.trim())
    setLocal(loc)
    setOpen(loc.length > 0)
    debRef.current = setTimeout(async () => {
      try {
        const res = await geocode(v.trim())
        setSuggestions(res)
        setOpen(loc.length > 0 || res.length > 0)
      } catch {
        setSuggestions([])
      }
    }, 350)
  }

  const pick = (r) => {
    onFlyTo(+r.lat, +r.lon, zoomForType(r.addresstype || r.type))
    setValue(r.display_name)
    setOpen(false)
  }

  const pickListing = (l) => {
    setOpen(false)
    setValue('')
    onOpenListing(l.id)
  }

  const doSearch = async () => {
    const v = value.trim()
    if (!v) return
    setOpen(false)
    const loc = matchListings(v)
    if (loc.length === 1) { pickListing(loc[0]); return }
    try {
      const res = await geocode(v, 1)
      if (res.length) onFlyTo(+res[0].lat, +res[0].lon, zoomForType(res[0].addresstype || res[0].type))
      else toast('Località non trovata')
    } catch {
      toast('Errore di ricerca, riprova')
    }
  }

  return (
    <header>
      <div className="logo">🏠 <span className="lg-txt">Casa<em>Trova</em></span></div>
      <div className="searchwrap" ref={wrapRef}>
        <div className="searchbox">
          <input
            type="text"
            value={value}
            onChange={onInput}
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }}
            placeholder={t('search_ph')}
            autoComplete="off"
          />
          <button title="Search" onClick={doSearch}>🔍</button>
        </div>
        {open && (
          <div className="suggestions">
            {local.map((l) => (
              <div key={'l' + l.id} onClick={() => pickListing(l)}>
                🏠 {(l.addr || '').split(',').slice(0, 2).join(',')} — <b>{fmtP(l, fx)}</b>
              </div>
            ))}
            {suggestions.map((r, i) => (
              <div key={i} onClick={() => pick(r)}>📍 {r.display_name}</div>
            ))}
          </div>
        )}
      </div>
      <button className="hbtn hbnew" onClick={onOpenHome} title={t('home_title')}>✨{newCount > 0 && <span className="badge">{newCount}</span>}</button>
      <button className="hbtn" onClick={onNearMe}>{t('near_me')}</button>
      <button className="hbtn" onClick={onOpenStats} title={t('stats_title')}>📊</button>
      {dealsCount > 0 && <button className={'hbtn' + (dealsActive ? ' hbon' : '')} onClick={onToggleDeals} title={t('deals_title')}>💎</button>}
      <button className="hbtn" onClick={onOpenSync} title={t('sync_title')}>🔄</button>
      <button className={'hbtn hbeur' + (eur ? ' hbon' : '')} onClick={toggleEur} title={t('eur_toggle')}>{eur ? '€' : '£'}</button>
      <div className="deskview">
        <button className={deskView === 'list' ? 'on' : ''} title={t('view_list')} onClick={() => onDeskView('list')}>☰</button>
        <button className={deskView === 'split' ? 'on' : ''} title={t('view_split')} onClick={() => onDeskView('split')}>◧</button>
        <button className={deskView === 'map' ? 'on' : ''} title={t('view_map')} onClick={() => onDeskView('map')}>🗺</button>
      </div>
      <div className="langtog">
        <button className={lang === 'it' ? 'on' : ''} onClick={() => setLang('it')}>IT</button>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
      </div>
    </header>
  )
}
