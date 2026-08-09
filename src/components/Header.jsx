import { useEffect, useRef, useState } from 'react'
import { geocode, zoomForType } from '../utils.js'
import { useI18n } from '../i18n.jsx'

export default function Header({ onFlyTo, onNearMe, toast }) {
  const { t, lang, setLang } = useI18n()
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState([])
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

  const onInput = (e) => {
    const v = e.target.value
    setValue(v)
    clearTimeout(debRef.current)
    if (v.trim().length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }
    debRef.current = setTimeout(async () => {
      try {
        const res = await geocode(v.trim())
        setSuggestions(res)
        setOpen(res.length > 0)
      } catch {
        setSuggestions([])
        setOpen(false)
      }
    }, 350)
  }

  const pick = (r) => {
    onFlyTo(+r.lat, +r.lon, zoomForType(r.addresstype || r.type))
    setValue(r.display_name)
    setOpen(false)
  }

  const doSearch = async () => {
    const v = value.trim()
    if (!v) return
    setOpen(false)
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
            {suggestions.map((r, i) => (
              <div key={i} onClick={() => pick(r)}>📍 {r.display_name}</div>
            ))}
          </div>
        )}
      </div>
      <button className="hbtn" onClick={onNearMe}>{t('near_me')}</button>
      <div className="langtog">
        <button className={lang === 'it' ? 'on' : ''} onClick={() => setLang('it')}>IT</button>
        <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
      </div>
    </header>
  )
}
