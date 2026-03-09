import type { Lang } from '../i18n'
import { t } from '../i18n'
import { copyReportToClipboard } from '../lib/reportBug'
import './ReportBugButton.css'

export interface ReportBugButtonProps {
  lang: Lang
  reportCopied: boolean
  setReportCopied: (v: boolean) => void
  context: Record<string, unknown>
}

export function ReportBugButton({
  lang,
  reportCopied,
  setReportCopied,
  context,
}: ReportBugButtonProps) {
  return (
    <button
      type="button"
      className="report-bug-btn"
      onClick={async () => {
        const ok = await copyReportToClipboard(context)
        if (ok) {
          setReportCopied(true)
          setTimeout(() => setReportCopied(false), 2500)
        }
      }}
      title={t(lang, 'reportBugTitle')}
      aria-label={t(lang, 'reportBug')}
    >
      {reportCopied ? t(lang, 'copied') : t(lang, 'reportBug')}
    </button>
  )
}
