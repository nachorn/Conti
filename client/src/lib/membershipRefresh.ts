/** Return to a visible page and explicit account opening read access from the server. */
export function subscribeMembershipRefresh(refresh: () => void, target: EventTarget, page: EventTarget & { readonly hidden: boolean }) {
  const refreshVisible = () => { if (!page.hidden) refresh() }
  target.addEventListener('focus', refreshVisible)
  page.addEventListener('visibilitychange', refreshVisible)
  return {
    refreshVisible,
    dispose() {
      target.removeEventListener('focus', refreshVisible)
      page.removeEventListener('visibilitychange', refreshVisible)
    },
  }
}
