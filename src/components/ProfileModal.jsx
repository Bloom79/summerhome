import { useState } from 'react'
import { useI18n } from '../i18n.jsx'

// One-time: who is using this device (distinguishes votes and notes).
export default function ProfileModal({ onSave, onClose }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  return (
    <div id="agentmodal" onClick={onClose}>
      <div className="agentbox" onClick={(e) => e.stopPropagation()}>
        <h3>👤 {t('profile_title')}</h3>
        <p className="agentexpl">{t('profile_explain')}</p>
        <div className="syncrow">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('profile_ph')}
            maxLength={12}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name) }}
            style={{ letterSpacing: 'normal', textTransform: 'none' }}
          />
          <button className="agentsend" disabled={!name.trim()} onClick={() => onSave(name)}>{t('profile_save')}</button>
        </div>
        <button className="agentcancel" onClick={onClose}>{t('agent_cancel')}</button>
      </div>
    </div>
  )
}
