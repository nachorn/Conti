import { randomUUID } from 'node:crypto'

export interface ChatMessage {
  id: string
  clientId: string
  playerId: string
  name: string
  text: string
  sentAt: number
}
export const CHAT_LIMIT = 50
export const CHAT_TEXT_LIMIT = 280

export function restoreChat(value: unknown): ChatMessage[] {
  if (value === undefined) return [] // Older saved games have no chat.
  if (!Array.isArray(value) || value.length > CHAT_LIMIT) throw new Error('Invalid saved chat')
  const ids = new Set<string>()
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id.length > 64 || ids.has(item.id) ||
      typeof item.clientId !== 'string' || !/^[\w-]{1,64}$/.test(item.clientId) ||
      typeof item.playerId !== 'string' || item.playerId.length > 64 ||
      typeof item.name !== 'string' || item.name.length > 128 ||
      typeof item.text !== 'string' || !item.text.trim() || item.text.length > CHAT_TEXT_LIMIT ||
      !Number.isFinite(item.sentAt) || item.sentAt < 0) throw new Error('Invalid saved chat')
    ids.add(item.id)
    return { id: item.id, clientId: item.clientId, playerId: item.playerId, name: item.name, text: item.text, sentAt: item.sentAt }
  })
}

export function appendChat(history: ChatMessage[], player: { id: string; name: string }, payload: unknown, now = Date.now()):
  { ok: true; messages: ChatMessage[]; duplicate: boolean } | { ok: false; error: string } {
  const input = payload as { clientId?: unknown; text?: unknown } | null
  if (!input || typeof input.clientId !== 'string' || !/^[\w-]{1,64}$/.test(input.clientId) ||
    typeof input.text !== 'string' || input.text.length > CHAT_TEXT_LIMIT || !input.text.trim()) return { ok: false, error: 'invalid' }
  const text = input.text.trim()
  const previous = history.find(m => m.playerId === player.id && m.clientId === input.clientId)
  if (previous) return previous.text === text ? { ok: true, messages: history, duplicate: true } : { ok: false, error: 'invalid' }
  if (history.filter(m => m.playerId === player.id && m.sentAt > now - 10_000).length >= 5) return { ok: false, error: 'rate_limit' }
  return { ok: true, duplicate: false, messages: [...history, {
    id: randomUUID(), clientId: input.clientId, playerId: player.id, name: player.name, text, sentAt: now,
  }].slice(-CHAT_LIMIT) }
}
