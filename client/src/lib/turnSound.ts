/** Short, quiet two-note ping; no remote assets or notification permissions. */
export function playTurnPing(context: AudioContext): boolean {
  if (context.state !== 'running') return false
  for (const [offset, frequency] of [[0, 740], [0.12, 988]]) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const at = context.currentTime + offset!
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency!
    gain.gain.setValueAtTime(0, at)
    gain.gain.linearRampToValueAtTime(0.12, at + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.22)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
    oscillator.start(at)
    oscillator.stop(at + 0.24)
  }
  return true
}

