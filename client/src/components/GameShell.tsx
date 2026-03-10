import type { Lang } from '../i18n'
import { t } from '../i18n'
import './GameShell.css'

export interface GameShellProps {
  backLabel: string
  onBack: () => void
  hideBack?: boolean
  lang: Lang
  setLang: (l: Lang) => void
  hideLang?: boolean
  error?: string | null
  toast?: string | null
  toastSuccess?: boolean
  /** Slot between lang and right (e.g. debug buttons) */
  debugSlot?: React.ReactNode
  /** Right side (e.g. scoreboard + report bug) */
  rightSlot?: React.ReactNode
}

/** Shared top bar, error banner, and toast for game boards. */
export function GameShell({
  backLabel,
  onBack,
  hideBack,
  lang,
  setLang,
  hideLang,
  error,
  toast,
  toastSuccess = true,
  debugSlot,
  rightSlot,
}: GameShellProps) {
  return (
    <>
      {error && (
        <div className="game-shell-error" role="alert">
          {error}
        </div>
      )}
      {toast && (
        <div
          className={`game-shell-toast ${toastSuccess ? 'game-shell-toast-success' : ''}`}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}
      <div className="game-shell-top-row">
        {!hideBack && (
          <button type="button" className="game-shell-back" onClick={onBack}>
            {backLabel}
          </button>
        )}
        {!hideLang && (
          <div className="game-shell-lang" role="group" aria-label={t(lang, 'language')}>
            <button
              type="button"
              className={lang === 'en' ? 'active' : ''}
              onClick={() => setLang('en')}
              aria-label={t(lang, 'langEn')}
              aria-pressed={lang === 'en'}
            >
              EN
            </button>
            <button
              type="button"
              className={lang === 'es' ? 'active' : ''}
              onClick={() => setLang('es')}
              aria-label={t(lang, 'langEs')}
              aria-pressed={lang === 'es'}
            >
              ES
            </button>
          </div>
        )}
        {debugSlot}
        {rightSlot != null && <div className="game-shell-right">{rightSlot}</div>}
      </div>
    </>
  )
}
