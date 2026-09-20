/** Private to current room members; never include chat in invitations or reports. */
export interface ChatMessage {
  id: string
  clientId: string
  playerId: string
  name: string
  text: string
  sentAt: number
}
export const CHAT_TEXT_LIMIT = 280
