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

// --- Tuner static ---------------------------------------------------------
//
// Synthesised rather than shipped as a file. A hiss is white noise through a
// pair of filters, which is a few lines here against a megabyte in the
// bundle, and it never tells on itself the way a short looped sample does.
//
// The screen already bursts into static on a channel change — crtMat's
// staticAmount in Model.jsx. This is that burst's sound, started and stopped
// with it.

let ctx = null
let noiseBuffer = null

// One context for the whole app. iOS starts it suspended and only a real
// gesture may resume it, which is what unlockAudio's caller is for.
export function audioContext() {
  if (ctx) return ctx
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!AC) return null
  try {
    ctx = new AC()
  } catch {
    return null
  }
  return ctx
}

function noise(ac) {
  if (noiseBuffer) return noiseBuffer
  // Two seconds, looped. Long enough that the loop point is inaudible.
  const len = Math.floor(ac.sampleRate * 2)
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  noiseBuffer = buf
  return buf
}

// Runaway guard: if the new channel never loads, the hiss still ends.
const STATIC_MAX_MS = 1400

export function startStatic(level = 0.16) {
  if (level <= 0) return null
  const ac = audioContext()
  if (!ac) return null
  if (ac.state === 'suspended') ac.resume()

  const src = ac.createBufferSource()
  src.buffer = noise(ac)
  src.loop = true

  // A set's hiss is bright but not piercing: drop the bottom so it doesn't
  // rumble through a phone speaker, cap the top so it doesn't sting.
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 900

  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 7000

  const gain = ac.createGain()
  gain.gain.setValueAtTime(0, ac.currentTime)
  gain.gain.linearRampToValueAtTime(level, ac.currentTime + 0.02)

  src.connect(hp)
  hp.connect(lp)
  lp.connect(gain)
  gain.connect(ac.destination)
  src.start()

  const handle = { ac, src, gain, timer: null }
  handle.timer = setTimeout(() => stopStatic(handle), STATIC_MAX_MS)
  return handle
}

export function stopStatic(handle) {
  if (!handle) return
  clearTimeout(handle.timer)
  handle.timer = null
  const { ac, src, gain } = handle
  const t = ac.currentTime
  try {
    // Ramped, not cut: stopping a hiss dead leaves a click behind it.
    gain.gain.cancelScheduledValues(t)
    gain.gain.setValueAtTime(gain.gain.value, t)
    gain.gain.linearRampToValueAtTime(0, t + 0.09)
    src.stop(t + 0.1)
  } catch {
    /* already stopped */
  }
}
