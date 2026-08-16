import { useState } from 'react'
import { useI18n } from '../i18n.jsx'

// Move favourites/notes/alerts between devices with a short code
// (stored via the worker in KV, 90-day retention).
export default function SyncModal({ onUpload, onDownload, onClose }) {
  const { t } = useI18n()
  const [code, setCode] = useState(() => { try { return localStorage.getItem('ct_synccode') || '' } catch { return '' } })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const upload = async () => {
    setBusy(true)
    const c = code || Array.from({ length: 6 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('')
    const ok = await onUpload(c)
    if (ok) {
      setCode(c)
      try { localStorage.setItem('ct_synccode', c) } catch { /* ignore */ }
    }
    setBusy(false)
  }

  const download = async () => {
    const c = input.trim().toUpperCase()
    if (c.length < 6) return
    setBusy(true)
    const ok = await onDownload(c)
    if (ok) {
      setCode(c)
      try { localStorage.setItem('ct_synccode', c) } catch { /* ignore */ }
    }
    setBusy(false)
  }

  return (
    <div id="agentmodal" onClick={onClose}>
      <div className="agentbox" onClick={(e) => e.stopPropagation()}>
        <h3>🔄 {t('sync_title')}</h3>
        <p className="agentexpl">{t('sync_explain')}</p>

        <div className="alform">
          <div className="alhead">{t('sync_send')}</div>
          {code && <div className="synccode">{code}</div>}
          <button className="agentsend" disabled={busy} onClick={upload}>
            {code ? t('sync_update') : t('sync_gen')}
          </button>
        </div>

        <div className="alform">
          <div className="alhead">{t('sync_recv')}</div>
          <div className="syncrow">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={12}
            />
            <button className="agentsend" disabled={busy || input.trim().length < 6} onClick={download}>{t('sync_get')}</button>
          </div>
        </div>

        <button className="agentcancel" onClick={onClose}>{t('agent_cancel')}</button>
      </div>
    </div>
  )
}
