import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CHAT_TEXT_LIMIT, type ChatMessage } from '@shared/roomChat'
import type { ActionResult } from '../types'
import type { Lang } from '../i18n'
import './RoomChat.css'

const EMOJIS = ['👋', '😂', '👏', '❤️', '😱', '😎']

export function RoomChat({ messages, playerId, lang, connected, send }: {
  messages: ChatMessage[]; playerId: string; lang: Lang; connected: boolean
  send: (text: string, clientId: string) => Promise<ActionResult>
}) {
  const es = lang === 'es'
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const seen = useRef(new Set(messages.map(m => m.id)))
  const pending = useRef(false)
  const retry = useRef<{ text: string; id: string } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)

  useEffect(() => {
    const incoming = messages.filter(m => !seen.current.has(m.id) && m.playerId !== playerId).length
    seen.current = new Set(messages.map(m => m.id))
    if (!open && incoming) setUnread(n => n + incoming)
    if (open && follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [messages, open, playerId])

  useEffect(() => {
    if (open) {
      setUnread(0)
      follow.current = true
      if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
      input.current?.focus({ preventScroll: true })
    }
  }, [open])

  function close() { setOpen(false); button.current?.focus() }
  async function submit(event?: FormEvent, emoji?: string) {
    event?.preventDefault()
    const text = (emoji ?? draft).trim()
    if (pending.current || !connected || !text) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const id = retry.current?.text === text ? retry.current.id : crypto.randomUUID()
      retry.current = { text, id }
      const result = await send(text, id)
      if (result.ok) {
        retry.current = null
        if (!emoji) setDraft('')
        follow.current = true
        if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
      } else setError(result.error === 'rate_limit'
        ? (es ? 'Espera unos segundos antes de enviar otro mensaje.' : 'Wait a few seconds before sending another message.')
        : result.error === 'invalid'
          ? (es ? 'Escribe entre 1 y 280 caracteres.' : 'Write between 1 and 280 characters.')
          : (es ? 'No se ha confirmado el envío. Conservamos el mensaje; puedes reintentarlo cuando haya conexión.' : 'Sending was not confirmed. Your message is kept; try again when connected.'))
    } catch { setError(es ? 'No se pudo enviar. Vuelve a intentarlo.' : 'Could not send. Please try again.') }
    finally { pending.current = false; setBusy(false) }
  }

  return <>
    <button ref={button} type="button" className="save-subtle room-chat-toggle" aria-expanded={open} aria-controls="room-chat-panel"
      aria-label={unread ? `Chat · ${unread} ${es ? 'sin leer' : 'unread'}` : 'Chat'} onClick={() => open ? close() : setOpen(true)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/></svg>
      Chat {unread > 0 && <span className="room-chat-badge">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <section id="room-chat-panel" className="room-chat-panel" aria-label={es ? 'Chat de la sala' : 'Room chat'} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close() }
    }}>
      <header><div><h2>{es ? 'Chat de la sala' : 'Room chat'}</h2><small>{es ? 'Solo esta mesa · últimos 50 mensajes' : 'This table only · last 50 messages'}</small></div>
        <button type="button" aria-label={es ? 'Cerrar chat' : 'Close chat'} onClick={close}>×</button></header>
      <div ref={scroll} className="room-chat-messages" role="log" aria-live="polite" aria-relevant="additions" aria-label={es ? 'Mensajes' : 'Messages'}
        onScroll={() => { const el = scroll.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 45 }}>
        {!messages.length && <p className="room-chat-empty">{es ? 'Saluda a la mesa 👋' : 'Say hello to the table 👋'}</p>}
        {messages.map(message => <article key={message.id} className={message.playerId === playerId ? 'room-chat-message is-own' : 'room-chat-message'}>
          <div><strong>{message.playerId === playerId ? (es ? 'Tú' : 'You') : message.name}</strong><time dateTime={new Date(message.sentAt).toISOString()}>{new Date(message.sentAt).toLocaleTimeString(es ? 'es-ES' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</time></div>
          <p>{message.text}</p>
        </article>)}
      </div>
      <form onSubmit={submit}>
        <div className="room-chat-emojis" role="group" aria-label={es ? 'Enviar un emoji' : 'Send an emoji'}>{EMOJIS.map(emoji => <button key={emoji} type="button" aria-label={`${es ? 'Enviar' : 'Send'} ${emoji}`} disabled={!connected || busy} onClick={() => void submit(undefined, emoji)}>{emoji}</button>)}</div>
        <label className="room-chat-input-label" htmlFor="room-chat-message">{es ? 'Tu mensaje' : 'Your message'}</label>
        <textarea ref={input} id="room-chat-message" rows={2} maxLength={CHAT_TEXT_LIMIT} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)}
          placeholder={es ? 'Escribe a la mesa…' : 'Write to the table…'} onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() }
          }} />
        <div className="room-chat-send"><small>{!connected ? (es ? 'Reconectando…' : 'Reconnecting…') : `${draft.length}/${CHAT_TEXT_LIMIT}`}</small>
          <button type="submit" className="save-primary" disabled={!connected || busy || !draft.trim()}>{busy ? '…' : es ? 'Enviar' : 'Send'}</button></div>
        {error && <p className="room-chat-error" role="alert">{error}</p>}
      </form>
    </section>}
  </>
}
