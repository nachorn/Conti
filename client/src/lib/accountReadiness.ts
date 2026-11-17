/** Keep unresolved identity separate from a confirmed signed-out account. */
export function accountView(state: { account: unknown; token: string | null; loaded: boolean; serverStatus: 'connecting' | 'ready' | 'unavailable' }): 'pending' | 'signed-in' | 'signed-out' {
  if (state.account && state.token) return 'signed-in'
  if (!state.account && state.loaded && state.serverStatus === 'ready' && !state.token) return 'signed-out'
  return 'pending'
}
