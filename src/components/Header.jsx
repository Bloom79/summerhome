import { useEffect, useRef, useState } from 'react'
import { geocode, zoomForType, fmtP } from '../utils.js'
import { useI18n } from '../i18n.jsx'
import { REGION, REGION_LIST, switchRegion } from '../region.js'

export default function Header({ listings, updated, gbpEur, onOpenListing, onFlyTo, onNearMe, onOpenStats, onOpenHome, newCount, onToggleDeals, dealsActive, dealsCount, hunterCount = 0, hunterGood = 0, onOpenHunter, onOpenSync, deskView, onDeskView, toast }) {
  const { t, lang, setLang, eur, setEur } = useI18n()
  // Phone overflow menu (☰): every header action that doesn't fit one row.
  const [menuOpen, setMenuOpen] = useState(false)
  const act = (fn) => { setMenuOpen(false); fn() }
  // Publish how much of the header may slide away on scroll (see hdr-hide in
  // index.css): everything but the UK/Ovindoli tabs, which stay in sight.
  const hdrRef = useRef(null)
  useEffect(() => {
    const el = hdrRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const tabs = el.querySelector('.hregion')
    const set = () => document.documentElement.style.setProperty('--hdr-h', (el.offsetHeight - (tabs?.offsetHeight || 0)) + 'px')
    const ro = new ResizeObserver(set)
    ro.observe(el)
    if (tabs) ro.observe(tabs)
    return () => ro.disconnect()
  }, [])
  // Never hide the header while its menu is open.
  useEffect(() => { if (menuOpen) document.documentElement.classList.remove('hdr-hide') }, [menuOpen])
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
    <header ref={hdrRef}>
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
      {/* Always in the bar: what's new and the deal hunter. */}
      <button className="hbtn hbnew" onClick={onOpenHome} title={t('home_title')}>✨{newCount > 0 && <span className="badge">{newCount}</span>}</button>
      {hunterCount > 0 && <button className="hbtn hbnew" onClick={onOpenHunter} title={t('hunter_title')}>🎯{hunterGood > 0 && <span className="badge">{hunterGood}</span>}</button>}
      {/* Desktop: the rest inline. Phone: hidden, reachable from ☰. */}
      <div className="hdesk">
        <button className="hbtn" onClick={onNearMe}>{t('near_me')}</button>
        <button className="hbtn" onClick={onOpenStats} title={t('stats_title')}>📊</button>
        {dealsCount > 0 && <button className={'hbtn' + (dealsActive ? ' hbon' : '')} onClick={onToggleDeals} title={t('deals_title')}>💎</button>}
        <button className="hbtn" onClick={onOpenSync} title={t('sync_title')}>🔄</button>
        {REGION.gbp && <button className={'hbtn hbeur' + (eur ? ' hbon' : '')} onClick={toggleEur} title={t('eur_toggle')}>{eur ? '€' : '£'}</button>}
        <div className="langtog regiontog" title={t('region_title')}>
          {REGION_LIST.map((r) => (
            <button key={r.id} className={r.id === REGION.id ? 'on' : ''} title={lang === 'en' ? r.nameEn : r.name} onClick={() => switchRegion(r.id)}>{r.flag} {r.short}</button>
          ))}
        </div>
        <div className="deskview">
          <button className={deskView === 'list' ? 'on' : ''} title={t('view_list')} onClick={() => onDeskView('list')}>☰</button>
          <button className={deskView === 'split' ? 'on' : ''} title={t('view_split')} onClick={() => onDeskView('split')}>◧</button>
          <button className={deskView === 'map' ? 'on' : ''} title={t('view_map')} onClick={() => onDeskView('map')}>🗺</button>
        </div>
        <div className="langtog">
          <button className={lang === 'it' ? 'on' : ''} onClick={() => setLang('it')}>IT</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
        </div>
      </div>
      {/* Phone: the two portals as tabs, always in sight (desktop has the
          UK/Ovindoli toggle inline above). */}
      <div className="hregion" role="tablist" aria-label={t('region_title')}>
        {REGION_LIST.map((r) => (
          <button key={r.id} role="tab" aria-selected={r.id === REGION.id} className={r.id === REGION.id ? 'on' : ''} onClick={() => switchRegion(r.id)}>{r.flag} {r.short}</button>
        ))}
      </div>
      <button className="hbtn hmenubtn" onClick={() => setMenuOpen((o) => !o)} aria-label={t('menu_title')} aria-expanded={menuOpen}>{menuOpen ? '✕' : '☰'}</button>
      {menuOpen && (
        <>
          <div className="hmenu-back" onClick={() => setMenuOpen(false)} />
          <nav className="hmenu" aria-label={t('menu_title')}>
            <div className="hmenu-meta">{t('menu_meta', { n: listings.length, date: updated ? `${updated.slice(8, 10)}/${updated.slice(5, 7)}` : '—' })}</div>
            <button onClick={() => act(onNearMe)}>{t('near_me')}</button>
            <button onClick={() => act(onOpenStats)}>📊 {t('stats_title')}</button>
            {dealsCount > 0 && <button className={dealsActive ? 'on' : ''} onClick={() => act(onToggleDeals)}>💎 {t('deals_title')} <span className="hm-n">{dealsCount}</span></button>}
            {hunterCount > 0 && <button onClick={() => act(onOpenHunter)}>🎯 {t('hunter_title')}{hunterGood > 0 && <span className="hm-n">{hunterGood}</span>}</button>}
            <button onClick={() => act(onOpenSync)}>🔄 {t('sync_title')}</button>
            {REGION.gbp && <button className={eur ? 'on' : ''} onClick={() => act(toggleEur)}>€ {t('eur_toggle')}</button>}
            <div className="hmenu-label">{t('region_title')}</div>
            <div className="hmenu-seg">
              {REGION_LIST.map((r) => (
                <button key={r.id} className={r.id === REGION.id ? 'on' : ''} onClick={() => switchRegion(r.id)}>{r.flag} {lang === 'en' ? r.nameEn : r.name}</button>
              ))}
            </div>
            <div className="hmenu-label">{t('menu_lang')}</div>
            <div className="hmenu-seg">
              <button className={lang === 'it' ? 'on' : ''} onClick={() => setLang('it')}>Italiano</button>
              <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
            </div>
          </nav>
        </>
      )}
    </header>
  )
}
