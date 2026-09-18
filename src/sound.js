// Shared UI click. Lives here rather than in App so the on-screen remote and
// the keyboard shortcuts make the same noise through the same code path.
//
// A pool rather than one element: tapping channel-up twice quickly would
// otherwise restart the single clip and swallow the first click.
const POOL = 4
const SRC = `${import.meta.env.BASE_URL}tv-ui-assets/sounds/remote-click.mp3`

let pool = null
let next = 0

function ensurePool() {
  if (pool || typeof Audio === 'undefined') return pool
  pool = Array.from({ length: POOL }, () => {
    const a = new Audio(SRC)
    a.preload = 'auto'
    return a
  })
  return pool
}

export function playClick() {
  const p = ensurePool()
  if (!p) return
  const a = p[next]
  next = (next + 1) % POOL
  try {
    a.currentTime = 0
    // Autoplay rejection is expected until the first gesture; not worth surfacing.
    a.play().catch(() => {})
  } catch {
    /* no-op */
  }
}

// iOS keeps audio locked until a real gesture. Every remote press is one, so
// priming here means the first tap is audible rather than silently swallowed.
export function unlockAudio() {
  const p = ensurePool()
  if (!p) return
  p.forEach((a) => {
    a.play()
      .then(() => {
        a.pause()
        a.currentTime = 0
      })
      .catch(() => {})
  })
}
