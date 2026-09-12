/** Public information available to someone holding a room invitation. No private seat data. */
export interface RoomInviteInfo {
  roomId: string
  gameType: 'continental' | 'pocha'
  hostName: string
  playerCount: number
  maxPlayers: number
  status: 'open' | 'full' | 'started'
}
