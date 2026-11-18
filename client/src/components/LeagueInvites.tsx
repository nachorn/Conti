import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { LeagueDetail, LeagueGameType } from '@shared/leagues'
import type { Lang } from '../i18n'
import { leagueAccountHash } from '../lib/leagueLinks'
import { isLeagueInvitation } from '../lib/leagues'
import { platformAccountHref } from '../lib/platform'
import { useLeagueRead } from '../useLeagueRead'

export function LeagueInviteLinks({ league, lang, busy, onRotate }: {
  league: LeagueDetail; lang: Lang; busy: boolean; onRotate: () => Promise<boolean>
}) {
  const es = lang === 'es'
  const field = useId()
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const hash = leagueAccountHash({ kind: 'invite', gameType: league.gameType, code: league.inviteCode })
  const link = new URL(platformAccountHref() + hash, window.location.origin).href
  const shareText = es ? `Únete a «${league.name}» en NRN Play\n${link}` : `Join “${league.name}” on NRN Play\n${link}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true); setCopyError(false)
    } catch { setCopied(false); setCopyError(true) }
  }
  return <details className="league-invite" open={league.gameCount === 0}>
    <summary>{es ? 'Invitar al grupo' : 'Invite your group'}</summary>
    <label htmlFor={field}>{es ? 'Enlace para unirse' : 'Join link'}</label>
    <input id={field} className="league-link-input" readOnly value={link} onFocus={event => event.currentTarget.select()} />
    <div className="leagues-entry-actions">
      <button type="button" className="membership-secondary" onClick={() => void copy()}>{es ? 'Copiar enlace' : 'Copy link'}</button>
      <a className="membership-secondary league-share-link" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">
        {es ? 'Compartir por WhatsApp' : 'Share on WhatsApp'}
      </a>
    </div>
    {copied && <p role="status">{es ? 'Enlace copiado.' : 'Link copied.'}</p>}
    {copyError && <p role="status">{es ? 'Selecciona el enlace de arriba para copiarlo.' : 'Select the link above to copy it.'}</p>}
    <p>{es ? 'Código para entrar' : 'Join code'} <strong>{league.inviteCode}</strong></p>
    {league.isOwner && (confirmRotate ? <div className="league-owner-action">
      <p>{es ? 'El enlace y el código anteriores caducarán. Los miembros actuales seguirán en la liga.' : 'The previous link and code will expire. Current members will stay in the league.'}</p>
      <div className="leagues-entry-actions">
        <button type="button" className="membership-secondary" disabled={busy} onClick={async () => { if (await onRotate()) setConfirmRotate(false) }}>
          {es ? 'Crear un enlace nuevo' : 'Create a new link'}
        </button>
        <button type="button" className="membership-text" disabled={busy} onClick={() => setConfirmRotate(false)}>{es ? 'Cancelar' : 'Cancel'}</button>
      </div>
    </div> : <button type="button" className="membership-text" disabled={busy} onClick={() => setConfirmRotate(true)}>
      {es ? 'Cambiar enlace y código' : 'Replace link and code'}
    </button>)}
  </details>
}

export function LeagueJoinInvitation({ code, gameType, token, lang, titleId, busy, onJoin, onOpen, onCancel, onSignIn }: {
  code: string; gameType: LeagueGameType; token: string | null; lang: Lang; titleId: string; busy: boolean
  onJoin: () => Promise<boolean>; onOpen: (id: string) => Promise<boolean>; onCancel: () => void; onSignIn: () => void
}) {
  const es = lang === 'es'
  const title = useRef<HTMLHeadingElement>(null)
  const body = useMemo(() => ({ code, expectedGameType: gameType }), [code, gameType])
  const { data, error, loading, retry } = useLeagueRead(token, '/invite/preview', isLeagueInvitation, body)
  const invite = data?.gameType === gameType ? data : null
  useEffect(() => { title.current?.focus() }, [])
  return <div className="league-form league-invitation">
    <h3 id={titleId} tabIndex={-1} ref={title}>{es ? 'Invitación a una liga' : 'League invitation'}</h3>
    {loading && <p role="status">{es ? 'Comprobando invitación…' : 'Checking invitation…'}</p>}
    {invite && <><strong>{invite.name}</strong><p>{gameType === 'pocha' ? 'La Pocha' : 'Conti'}</p></>}
    {invite?.closedAt != null && !invite.isMember && <p role="status">{es ? 'Esta liga está cerrada.' : 'This league is closed.'}</p>}
    {error === 'unauthorized' && <p role="alert">{es ? 'Vuelve a entrar en tu cuenta para confirmar.' : 'Sign in again to confirm.'}</p>}
    {(error === 'league_closed' || error === 'league_not_found' || error === 'invalid_invite_code' || error === 'league_wrong_game') &&
      <p role="alert">{es ? 'Esta invitación ya no está disponible. Pide un enlace nuevo.' : 'This invitation is no longer available. Ask for a new link.'}</p>}
    {(error === 'unavailable' || error === 'rate_limited' || (data && !invite)) && <p role="alert">{es ? 'No se pudo comprobar la invitación.' : 'We could not check the invitation.'}</p>}
    <div className="leagues-entry-actions">
      {invite && (invite.isMember || invite.closedAt === null) && <button type="button" className="membership-primary" disabled={busy}
        onClick={() => void (invite.isMember ? onOpen(invite.id) : onJoin()).then(ok => { if (ok) onCancel() })}>
        {invite.isMember ? (es ? 'Ver liga' : 'View league') : (es ? 'Confirmar y unirme' : 'Confirm and join')}
      </button>}
      {(error === 'unavailable' || error === 'rate_limited') && <button className="membership-secondary" type="button" onClick={retry}>{es ? 'Reintentar' : 'Try again'}</button>}
      {error === 'unauthorized' && <button type="button" className="membership-secondary" onClick={onSignIn}>{es ? 'Volver a entrar' : 'Sign in again'}</button>}
      <button type="button" className="membership-text" disabled={busy} onClick={onCancel}>{es ? 'Cancelar' : 'Cancel'}</button>
    </div>
  </div>
}
