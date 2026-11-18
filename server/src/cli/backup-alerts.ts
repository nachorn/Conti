import { realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMembershipEmailSender } from '../membershipEmail.js'
import { parseBackupAlertState, parseBackupStatus, planBackupNotice, readBackupMetadata, writeBackupMetadata, type BackupStatus, type BackupAlertState } from '../operations/backupStatus.js'

export async function backupAlertsMain(args = process.argv.slice(2), env = process.env, request: typeof fetch = fetch, now: () => number = Date.now): Promise<void> {
  try {
    if (args.some(x => x !== '--plan' && x !== '--apply') || args.includes('--plan') && args.includes('--apply')) throw new Error('Invalid backup alert option')
    const apply = args.includes('--apply'), statusPath = env.NRN_BACKUP_STATUS_PATH, alertPath = env.NRN_BACKUP_ALERT_STATE_PATH
    if (!statusPath || !alertPath || !isAbsolute(statusPath) || !isAbsolute(alertPath) || resolve(statusPath) === resolve(alertPath)) throw new Error('Distinct absolute backup metadata paths required')
    const csv = env.NRN_BACKUP_ALERT_EMAILS ?? ''
    if (/[\u0000-\u001f\u007f]/.test(csv)) throw new Error('Invalid private backup recipient configuration')
    const recipients = [...new Set(csv.split(',').map(x => x.trim().toLowerCase()).filter(Boolean))]
    if (!recipients.length || recipients.length > 5 || recipients.some(x => x.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))) throw new Error('Private owner recipients required')
    let status: BackupStatus | null = null, prior: BackupAlertState | null = null
    try { const raw = await readBackupMetadata(statusPath); status = raw === null ? null : parseBackupStatus(raw) } catch { /* Never treat unreadable metadata as a fresh backup. */ }
    try { const raw = await readBackupMetadata(alertPath); prior = raw === null ? null : parseBackupAlertState(raw) } catch { /* A fresh grace period is safer than sending repeated uncertain deliveries. */ }
    const plan = planBackupNotice(status, prior, now())
    const sender = createMembershipEmailSender(env, request, now)
    if (!sender) throw new Error('Backup notice transport unavailable')
    let delivery = 'none'
    if (apply) {
      // Persist the attempt before sending: timeouts/crashes must not cause immediate duplicate email.
      await writeBackupMetadata(alertPath, plan.state)
      if (plan.notice) {
        delivery = 'confirmed'
        for (const email of recipients) {
          try { await sender.backupNotice(email, plan.notice) } catch { delivery = 'unconfirmed' }
        }
        if (delivery === 'unconfirmed') process.exitCode = 1
      }
    }
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'plan', health: plan.health, notice: plan.notice?.kind ?? null,
      recipientsConfigured: recipients.length, transportConfigured: true, delivery, databaseOpened: false }))
  } catch {
    console.error('backup_alert_check_failed'); process.exitCode = 1
  }
}
try {
  if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) void backupAlertsMain()
} catch { /* An import is inert. */ }
