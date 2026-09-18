import { Suspense, useRef, useState, useCallback, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { CameraControls, Environment, Stats } from '@react-three/drei'
import { Vector3 } from 'three'
import { getProject } from '@theatre/core'
import studio from '@theatre/studio'
import extension from '@theatre/r3f/dist/extension'
import { editable as e, SheetProvider } from '@theatre/r3f'
import Model from './Model'
import RemoteHud from './RemoteHud'
import { playClick, unlockAudio, audioContext } from './sound'
import useChannelStore from './store'
import './App.css'

// Initialize Theatre.js studio (dev only — skip heavy UI init in production)
if (import.meta.env.DEV) {
  studio.extend(extension)
  studio.initialize()
  studio.ui.hide()
}

const project = getProject('Lucki TV')
const sheet = project.sheet('Scene')

const HARDCODED_DEFAULT = {
  position: new Vector3(12.02, 3.64, -26.01),
  target: new Vector3(12.04, 3.72, -35.65),
}

const TV_CLOSE_UP = {
  position: new Vector3(12.03, 5.34, -29.99),
  target: new Vector3(12.05, 5.42, -39.63),
}

// Mobile-specific camera positions
const MOBILE_DEFAULT = {
  position: new Vector3(12.87, 6.86, -24.93),
  target: new Vector3(11.02, -1.02, -63.88),
}

const MOBILE_TV_CLOSE_UP = {
  position: new Vector3(12.61, 6.86, -27.82),
  target: new Vector3(10.76, -1.02, -66.77),
}

function isMobile() {
  return window.innerWidth / window.innerHeight < 1
}

// The peel.
//
// A sticker doesn't tip off a surface in one piece — a fold line travels
// across it, the part behind the line curls back over the part still stuck
// down, and what's ahead of the line stays flat. That's what this draws, as
// real geometry rather than a tilt.
//
// Everything happens in a frame rotated by PEEL_ANGLE, so the fold is a plain
// vertical line at x = t sweeping across, and the maths stays simple:
//
//   stuck  the face, clipped to x >= t — what hasn't lifted yet
//   curl   the backing circle, clipped to x <= t (the lifted part), then
//          folded back over the fold line so it lies on top of the face
//
// The fold maps x to t + CURL*(t - x): a reflection about x = t, squashed
// along x. Squashed because the lifted part doesn't lie flat against the
// sticker, it rolls — and a roll seen from the front is foreshortened. At
// CURL = 1 this is a hard crease, which is what a folded paper circle does,
// not what a sticker peeling does.
//
// A circle has no corners, but a crease across one has two, where the folded
// edge meets the arc. PEEL_ROUND takes those off: blur the shape, then push
// the alpha back to hard through a colour matrix. Straight edges survive that
// untouched; corners come back rounded.
const PEEL_ANGLE = -35
const PEEL_CURL = 0.52
const PEEL_REST = -10
const PEEL_SPAN = 168
const PEEL_MS = 700

// The store is asked for a shade before the fold finishes, so the page turns
// over on the last of it rather than after a beat of nothing.
const PEEL_NAV_MS = 600

// How far the clip rects run past the art, so their far edges never cut it.
const CLIP_BACK = 600

// Where the exit button goes.
//
// The viewer is a static site on its own domain, embedded in an iframe on the
// store's /pages/tv, so it can't know the shop's URL at build time. It reads
// it off the referrer instead: Shopify's default referrer policy trims a
// cross-origin referrer to the bare origin, which is the shop's front page —
// exactly what's wanted. ?home=<url> overrides that when the referrer is
// stripped or the viewer is opened on its own.
function storeHomeUrl() {
  const override = new URLSearchParams(window.location.search).get('home')
  if (override) {
    try {
      return new URL(override, window.location.href).href
    } catch {
      /* malformed — fall through to the referrer */
    }
  }
  if (document.referrer) {
    try {
      const ref = new URL(document.referrer)
      if (ref.origin !== window.location.origin) return ref.origin + '/'
    } catch {
      /* fall through */
    }
  }
  return null
}

// Leaving is a top-level navigation out of the iframe, not a navigation of
// the iframe itself — otherwise the store loads inside the TV page.
function leaveForStore() {
  const url = storeHomeUrl()
  const embedded = window.top !== window.self

  if (!url) {
    // Nothing we can name. The back stack is the only honest answer left.
    if (window.history.length > 1) window.history.back()
    return
  }

  if (!embedded) {
    window.location.href = url
    return
  }

  // A cross-origin frame may drive the top frame on a real user gesture, which
  // a click is. window.open('_top') covers the case where it can't.
  try {
    window.top.location.href = url
  } catch {
    window.open(url, '_top')
  }
}

function Loader() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#444" wireframe />
    </mesh>
  )
}

// Blender-style drag-to-scrub input
function ScrubInput({ label, value, onChange, color }) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startVal = useRef(0)
  const inputRef = useRef()

  const handlePointerDown = (e) => {
    if (editing) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    startX.current = e.clientX
    startVal.current = value
    setDragging(true)
  }

  const handlePointerMove = (e) => {
    if (!dragging || editing) return
    const dx = e.clientX - startX.current
    const sensitivity = e.shiftKey ? 0.001 : 0.02
    onChange(+(startVal.current + dx * sensitivity).toFixed(2))
  }

  const handlePointerUp = () => setDragging(false)

  const handleDoubleClick = () => {
    setEditing(true)
    setEditValue(String(value))
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitEdit = () => {
    const parsed = parseFloat(editValue)
    if (!isNaN(parsed)) onChange(+parsed.toFixed(2))
    setEditing(false)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <div className="scrub-field">
      <span className="scrub-label" style={{ color }}>{label}</span>
      {editing ? (
        <input
          ref={inputRef}
          className="scrub-edit"
          type="number"
          step="0.1"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div
          className={`scrub-value${dragging ? ' dragging' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          {value.toFixed(2)}
        </div>
      )}
    </div>
  )
}

// --- WASD Camera Movement (runs inside Canvas) ---
const keysHeld = new Set()
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => keysHeld.add(e.code))
  window.addEventListener('keyup', (e) => keysHeld.delete(e.code))
  window.addEventListener('blur', () => keysHeld.clear())
}

function WASDControls({ controlsRef }) {
  useFrame((_, delta) => {
    const ctrl = controlsRef.current
    if (!ctrl) return
    if (document.activeElement?.tagName === 'INPUT') return

    const fast = keysHeld.has('ShiftLeft') || keysHeld.has('ShiftRight')
    const speed = (fast ? 8 : 3) * delta

    // Forward/back
    if (keysHeld.has('KeyW')) ctrl.forward(speed, false)
    if (keysHeld.has('KeyS')) ctrl.forward(-speed, false)
    // Left/right
    if (keysHeld.has('KeyA')) ctrl.truck(-speed, 0, false)
    if (keysHeld.has('KeyD')) ctrl.truck(speed, 0, false)
    // Up/down
    if (keysHeld.has('KeyQ')) ctrl.truck(0, speed, false)
    if (keysHeld.has('KeyE')) ctrl.truck(0, -speed, false)
  })
  return null
}

// --- FPS Tracker (inside Canvas) ---
function FpsTracker({ fpsRef }) {
  useFrame((_, delta) => {
    if (delta > 0) fpsRef.current = fpsRef.current * 0.85 + (1 / delta) * 0.15
  })
  return null
}

// --- Scene Lights (Theatre.js editable, toggled via store) ---
function SceneLights() {
  const sl = useChannelStore((s) => s.sceneLights)
  return (
    <>
      <color attach="background" args={['#ffffff']} />
      <ambientLight intensity={sl.ambient ? 0.3 : 0} />
      <e.directionalLight
        theatreKey="Key Light"
        position={[5, 8, 5]}
        intensity={sl.keyLight ? 1.5 : 0}
        castShadow={!isMobile() && sl.keyLight}
        shadow-mapSize={[512, 512]}
      />
      <e.directionalLight
        theatreKey="Fill Light"
        position={[-3, 4, -5]}
        intensity={sl.fillLight ? 0.5 : 0}
      />
      <e.pointLight
        theatreKey="Point Light"
        position={[0, 6, -20]}
        intensity={sl.pointLight ? 2 : 0}
      />
      <e.spotLight
        theatreKey="Spot Light"
        position={[0, 10, -20]}
        angle={0.3}
        penumbra={0.5}
        intensity={sl.spotLight ? 2 : 0}
      />
    </>
  )
}

// --- Layer & Animation Panel ---
const LAYER_LABELS = [
  ['lightBars', 'Light Bars'],
  ['pipes', 'Pipes'],
  ['cylinders', 'Cylinders'],
  ['cubes', 'Cubes'],
  ['planes', 'Planes'],
  ['guitarStrap', 'Guitar Strap'],
  ['curves', 'Curves'],
]

const LIGHT_LABELS = [
  ['ambient', 'Ambient'],
  ['keyLight', 'Key Light'],
  ['fillLight', 'Fill Light'],
  ['pointLight', 'Point Light'],
  ['spotLight', 'Spot Light'],
]

function LayersPanel() {
  const layers = useChannelStore((s) => s.layers)
  const toggle = useChannelStore((s) => s.toggleLayer)
  const animPlaying = useChannelStore((s) => s.animationPlaying)
  const toggleAnim = useChannelStore((s) => s.toggleAnimation)
  const envVisible = useChannelStore((s) => s.envVisible)
  const toggleEnv = useChannelStore((s) => s.toggleEnv)
  const sceneLights = useChannelStore((s) => s.sceneLights)
  const toggleLight = useChannelStore((s) => s.toggleSceneLight)

  return (
    <div className="layers-section">
      <div className="section-label">Animation</div>
      <button
        className={`layer-toggle anim-toggle${animPlaying ? ' on' : ''}`}
        onClick={toggleAnim}
      >
        <span className="layer-eye">{animPlaying ? '▶' : '■'}</span>
        {animPlaying ? 'Playing' : 'Stopped'}
      </button>

      <div className="section-label">Lights</div>
      <div className="layers-grid">
        {LIGHT_LABELS.map(([key, label]) => (
          <button
            key={key}
            className={`layer-toggle${sceneLights[key] ? ' on' : ''}`}
            onClick={() => toggleLight(key)}
          >
            <span className="layer-eye">{sceneLights[key] ? '●' : '○'}</span>
            {label}
          </button>
        ))}
      </div>

      <div className="section-label">Layers</div>
      <button
        className={`layer-toggle${envVisible ? ' on' : ''}`}
        onClick={toggleEnv}
        style={{ width: '100%', marginBottom: 4 }}
      >
        <span className="layer-eye">{envVisible ? '●' : '○'}</span>
        Environment
      </button>
      <div className="layers-grid">
        {LAYER_LABELS.map(([key, label]) => (
          <button
            key={key}
            className={`layer-toggle${layers[key] ? ' on' : ''}`}
            onClick={() => toggle(key)}
          >
            <span className="layer-eye">{layers[key] ? '●' : '○'}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

// --- Camera Slots ---
function CameraSlots({ controlsRef, onGoTo }) {
  const slots = useChannelStore((s) => s.cameraSlots)
  const defaultIdx = useChannelStore((s) => s.defaultSlotIndex)
  const saveSlot = useChannelStore((s) => s.saveSlot)
  const deleteSlot = useChannelStore((s) => s.deleteSlot)
  const renameSlot = useChannelStore((s) => s.renameSlot)
  const setDefault = useChannelStore((s) => s.setDefaultSlot)
  const updateSlot = useChannelStore((s) => s.updateSlot)
  const [editingIdx, setEditingIdx] = useState(null)
  const [editName, setEditName] = useState('')
  const editRef = useRef()

  const handleSaveNew = () => {
    const ctrl = controlsRef.current
    if (!ctrl) return
    const p = new Vector3()
    const t = new Vector3()
    ctrl.getPosition(p)
    ctrl.getTarget(t)
    const name = 'View ' + (slots.length + 1)
    saveSlot(name,
      { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      { x: +t.x.toFixed(2), y: +t.y.toFixed(2), z: +t.z.toFixed(2) }
    )
  }

  const handleOverwrite = (i) => {
    const ctrl = controlsRef.current
    if (!ctrl) return
    const p = new Vector3()
    const t = new Vector3()
    ctrl.getPosition(p)
    ctrl.getTarget(t)
    updateSlot(i,
      { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) },
      { x: +t.x.toFixed(2), y: +t.y.toFixed(2), z: +t.z.toFixed(2) }
    )
  }

  const startRename = (i) => {
    setEditingIdx(i)
    setEditName(slots[i].name)
    setTimeout(() => editRef.current?.select(), 0)
  }

  const commitRename = () => {
    if (editingIdx !== null && editName.trim()) {
      renameSlot(editingIdx, editName.trim())
    }
    setEditingIdx(null)
  }

  return (
    <div className="slots-section">
      <div className="section-label">Camera Positions</div>
      <div className="slots-list">
        {slots.map((slot, i) => (
          <div key={i} className={`slot-row${defaultIdx === i ? ' is-default' : ''}`}>
            {editingIdx === i ? (
              <input
                ref={editRef}
                className="slot-name-edit"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingIdx(null) }}
              />
            ) : (
              <button className="slot-name" onClick={() => onGoTo(slot)} onDoubleClick={() => startRename(i)}>
                {defaultIdx === i && <span className="slot-default-badge">D</span>}
                {slot.name}
              </button>
            )}
            <div className="slot-actions">
              <button className="slot-act" title="Set as default" onClick={() => setDefault(defaultIdx === i ? -1 : i)}>
                {defaultIdx === i ? '★' : '☆'}
              </button>
              <button className="slot-act" title="Overwrite with current" onClick={() => handleOverwrite(i)}>↻</button>
              <button className="slot-act slot-delete" title="Delete" onClick={() => deleteSlot(i)}>×</button>
            </div>
          </div>
        ))}
      </div>
      <button className="save-btn" onClick={handleSaveNew}>
        + Save Current Position
      </button>
      {slots.length > 0 && (
        <div className="slots-io">
          <button className="io-btn" onClick={() => {
            const data = JSON.stringify({ slots, defaultIndex: defaultIdx }, null, 2)
            const blob = new Blob([data], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'camera-positions.json'
            a.click()
            URL.revokeObjectURL(url)
          }}>Export</button>
          <button className="io-btn" onClick={() => {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = '.json'
            input.onchange = (e) => {
              const file = e.target.files[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = (ev) => {
                try {
                  const data = JSON.parse(ev.target.result)
                  if (Array.isArray(data.slots)) {
                    localStorage.setItem('lucki-tv-camera-slots', JSON.stringify(data.slots))
                    if (typeof data.defaultIndex === 'number') {
                      localStorage.setItem('lucki-tv-default-slot', String(data.defaultIndex))
                    }
                    useChannelStore.setState({
                      cameraSlots: data.slots,
                      defaultSlotIndex: data.defaultIndex ?? -1,
                    })
                  }
                } catch {}
              }
              reader.readAsText(file)
            }
            input.click()
          }}>Import</button>
        </div>
      )}
    </div>
  )
}

// --- FPS Log Section (shown inside H panel) ---
function FpsLogSection({ fpsRef, logRef }) {
  const [fpsDisplay, setFpsDisplay] = useState(60)

  useEffect(() => {
    const id = setInterval(() => setFpsDisplay(Math.round(fpsRef.current)), 500)
    return () => clearInterval(id)
  }, [fpsRef])

  const log = logRef.current
  return (
    <div className="fps-log-section">
      <div className="section-label">Performance</div>
      <div className="fps-display">FPS: {fpsDisplay}</div>
      {log.length > 0 && (
        <>
          <div className="fps-log-header">Event Log</div>
          <pre className="fps-log-entries">
            {log.map((e) => {
              const fpsStr = typeof e.fps === 'number' ? String(e.fps).padStart(3) : e.fps
              const drop = typeof e.fps === 'number' && e.fps < 45 ? ' ▼' : ''
              return `→ ${e.label.padEnd(20)} ${fpsStr}fps${drop}`
            }).join('\n')}
          </pre>
        </>
      )}
    </div>
  )
}

// --- Main Camera Panel ---
function CameraPanel({ controlsRef, onGoTo, fpsRef, logRef }) {
  const [pos, setPos] = useState({ x: 0, y: 0, z: 5 })
  const [target, setTarget] = useState({ x: 0, y: 0, z: 0 })
  const interactingRef = useRef(false)
  useEffect(() => {
    const ctrl = controlsRef.current
    if (!ctrl) return
    const tmpPos = new Vector3()
    const tmpTgt = new Vector3()
    const sync = () => {
      if (interactingRef.current) return
      ctrl.getPosition(tmpPos)
      ctrl.getTarget(tmpTgt)
      setPos({ x: +tmpPos.x.toFixed(2), y: +tmpPos.y.toFixed(2), z: +tmpPos.z.toFixed(2) })
      setTarget({ x: +tmpTgt.x.toFixed(2), y: +tmpTgt.y.toFixed(2), z: +tmpTgt.z.toFixed(2) })
    }
    sync()
    ctrl.addEventListener('update', sync)
    return () => ctrl.removeEventListener('update', sync)
  }, [controlsRef])

  const applyToCamera = useCallback((newPos, newTarget) => {
    const ctrl = controlsRef.current
    if (!ctrl) return
    ctrl.setLookAt(newPos.x, newPos.y, newPos.z, newTarget.x, newTarget.y, newTarget.z, false)
  }, [controlsRef])

  const updatePos = (axis, val) => {
    interactingRef.current = true
    const next = { ...pos, [axis]: val }
    setPos(next)
    applyToCamera(next, target)
    clearTimeout(updatePos._t)
    updatePos._t = setTimeout(() => { interactingRef.current = false }, 300)
  }

  const updateTarget = (axis, val) => {
    interactingRef.current = true
    const next = { ...target, [axis]: val }
    setTarget(next)
    applyToCamera(pos, next)
    clearTimeout(updateTarget._t)
    updateTarget._t = setTimeout(() => { interactingRef.current = false }, 300)
  }

  return (
    <div className="camera-panel">
      <h3>Camera</h3>

      <div className="section-label">Position</div>
      <div className="scrub-row">
        <ScrubInput label="X" color="#e05555" value={pos.x} onChange={(v) => updatePos('x', v)} />
        <ScrubInput label="Y" color="#55b855" value={pos.y} onChange={(v) => updatePos('y', v)} />
        <ScrubInput label="Z" color="#5588e0" value={pos.z} onChange={(v) => updatePos('z', v)} />
      </div>

      <div className="section-label">Target</div>
      <div className="scrub-row">
        <ScrubInput label="X" color="#e05555" value={target.x} onChange={(v) => updateTarget('x', v)} />
        <ScrubInput label="Y" color="#55b855" value={target.y} onChange={(v) => updateTarget('y', v)} />
        <ScrubInput label="Z" color="#5588e0" value={target.z} onChange={(v) => updateTarget('z', v)} />
      </div>

      <CameraSlots controlsRef={controlsRef} onGoTo={onGoTo} />

      <LayersPanel />

      <FpsLogSection fpsRef={fpsRef} logRef={logRef} />

      <div className="hint">WASD &mdash; move &middot; QE &mdash; up/down &middot; Shift &mdash; fast</div>
      <div className="hint">O &mdash; TV on/off &middot; H &mdash; hide panel &middot; L &mdash; animation</div>
      <div className="hint">&uarr;&darr; &mdash; channels &middot; +/- &mdash; volume &middot; M &mdash; mute</div>
      <div className="hint">0-9 &mdash; channel &middot; Space &mdash; default view</div>
      <div className="hint">Double-click slot name to rename</div>
    </div>
  )
}

// --- Loading Logo Animation ---
const LOGOS = [
  { src: 'logo1.png', size: 248, x: 0,  y: 0  },
  { src: 'logo2.png', size: 165, x: 10, y: -7 },
  { src: 'logo3.png', size: 215, x: 7,  y: 6  },
  { src: 'logo4.png', size: 253, x: 3,  y: -1 },
  { src: 'logo5.png', size: 214, x: 9,  y: 8  },
  { src: 'logo6.png', size: 188, x: 3,  y: 4  },
  { src: 'logo7.png', size: 245, x: 5,  y: -6 },
  { src: 'logo8.png', size: 210, x: -4, y: -4 },
]

// CSS keyframe animations — run on compositor thread, immune to main-thread load
// Each logo fades in/out during its 1s slot in an 8s cycle with 0.5s crossfades
const CYCLE_S = LOGOS.length       // 8s total
const FADE_PCT = (0.5 / CYCLE_S) * 100  // 6.25% per fade

const logoKeyframeCSS = LOGOS.map((_, i) => {
  const peak = (i / LOGOS.length) * 100
  const fi = (peak - FADE_PCT).toFixed(3)
  const fo = (peak + FADE_PCT).toFixed(3)
  const p = peak.toFixed(3)
  if (i === 0) {
    // Wraps around 0%/100% boundary
    return `@keyframes logo-${i}{0%{opacity:1}${fo}%{opacity:0}${(100 - FADE_PCT).toFixed(3)}%{opacity:0}100%{opacity:1}}`
  }
  return `@keyframes logo-${i}{0%{opacity:0}${fi}%{opacity:0}${p}%{opacity:1}${fo}%{opacity:0}100%{opacity:0}}`
}).join('')

function LogoAnimation() {
  return (
    <>
      <style>{logoKeyframeCSS}</style>
      <div className="loading-logo-wrap">
        {LOGOS.map((l, i) => (
          <img
            key={i}
            src={`${import.meta.env.BASE_URL}loading/${l.src}`}
            alt=""
            style={{
              position: 'absolute',
              objectFit: 'contain',
              width: l.size,
              height: l.size,
              left: `calc(50% - ${l.size / 2}px + ${l.x}px)`,
              top: `calc(50% - ${l.size / 2}px + ${l.y}px)`,
              animation: `logo-${i} ${CYCLE_S}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
    </>
  )
}

function App() {
  const controlsRef = useRef()
  const [panelVisible, setPanelVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [overlayFading, setOverlayFading] = useState(false)
  const [animDone, setAnimDone] = useState(false)
  const [stickyFalling, setStickyFalling] = useState(false)
  const onAnimEndCallbackRef = useRef(null)

  // Called by Model when the animation mixer fires 'finished'
  const handleModelAnimEnd = useCallback(() => {
    if (onAnimEndCallbackRef.current) {
      onAnimEndCallbackRef.current()
      onAnimEndCallbackRef.current = null
    } else {
      // Second animation (visible replay) finished
      setAnimDone(true)
    }
  }, [])

  // FPS logger — captures min fps over 600ms after event to catch the actual drop
  const fpsRef = useRef(60)
  const logRef = useRef([])
  const [, setLogVersion] = useState(0)
  const logEvent = useCallback((label) => {
    logRef.current = [{ label, fps: '…' }, ...logRef.current].slice(0, 10)
    setLogVersion(v => v + 1)
    let minFps = fpsRef.current
    let ticks = 0
    const id = setInterval(() => {
      if (fpsRef.current < minFps) minFps = fpsRef.current
      ticks++
      if (ticks >= 12) {
        clearInterval(id)
        logRef.current[0] = { label, fps: Math.round(minFps) }
        setLogVersion(v => v + 1)
      }
    }, 50)
  }, [])

  // Go to a camera position (slot object, 'default', or 'tv')
  const goToView = useCallback((slotOrKey) => {
    const ctrl = controlsRef.current
    if (!ctrl) return
    let p, t
    const mobile = isMobile()
    if (slotOrKey === 'default') {
      const s = useChannelStore.getState()
      if (s.defaultSlotIndex >= 0 && s.cameraSlots[s.defaultSlotIndex]) {
        const slot = s.cameraSlots[s.defaultSlotIndex]
        p = slot.position
        t = slot.target
      } else {
        p = mobile ? MOBILE_DEFAULT.position : HARDCODED_DEFAULT.position
        t = mobile ? MOBILE_DEFAULT.target : HARDCODED_DEFAULT.target
      }
    } else if (slotOrKey === 'tv') {
      p = mobile ? MOBILE_TV_CLOSE_UP.position : TV_CLOSE_UP.position
      t = mobile ? MOBILE_TV_CLOSE_UP.target : TV_CLOSE_UP.target
    } else {
      p = slotOrKey.position
      t = slotOrKey.target
    }
    // Quick cinematic transition
    const origSmooth = ctrl.smoothTime
    ctrl.smoothTime = mobile ? 0.4 : 0.7
    ctrl.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, true)
    setTimeout(() => { ctrl.smoothTime = origSmooth }, mobile ? 600 : 1000)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT') return
      const s = useChannelStore.getState()

      // H key debug panel toggle — disabled
      // if (e.key === 'h' || e.key === 'H') { ... }
      if (e.code === 'Space') {
        e.preventDefault()
        logEvent('Camera reset')
        goToView('default')
        return
      }

      // Number keys 1-9 for camera slots (with Ctrl)
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const idx = parseInt(e.key) - 1
        if (s.cameraSlots[idx]) {
          logEvent(`Camera slot ${e.key}`)
          goToView(s.cameraSlots[idx])
        }
        return
      }

      // Mute toggle
      if (e.key === 'm' || e.key === 'M') {
        s.toggleMute()
        return
      }

      // L key — animation toggle disabled (auto-plays like mobile)

      // TV power toggle
      if (e.key === 'o' || e.key === 'O') {
        logEvent(s.tvOn ? 'TV power off' : 'TV power on')
        playClick()
        s.togglePower()
        return
      }

      // Volume — when TV is on
      if (s.phase !== 'off') {
        if (e.key === '+' || e.key === '=') {
          playClick()
          s.volumeUp()
          return
        }
        if (e.key === '-' || e.key === '_') {
          playClick()
          s.volumeDown()
          return
        }
      }

      // Channel controls — only in channels mode
      if (s.phase !== 'channels') return
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        logEvent('Channel up')
        playClick()
        s.nextChannel()
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        logEvent('Channel down')
        playClick()
        s.prevChannel()
      }
      const digit = parseInt(e.key)
      if (!isNaN(digit)) {
        logEvent(`Channel #${digit}`)
        playClick()
        s.enterChannelNumber(digit)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goToView, logEvent])

  // Tapping the scene pulls the camera in on the TV — desktop only.
  //
  // Mobile used to run a tap-anywhere sequence here: power on and pull in,
  // then back out, then power off. The on-screen remote lives in the same
  // scene and its buttons do raycast, and R3F's stopPropagation only stops
  // other 3D objects — the native event still bubbled to this div. So every
  // remote press fired the sequence as well: power turned the set on and
  // this turned it straight back off, and any button flung the camera. On
  // mobile the remote owns the TV, and nothing happens off it.
  const handleBackgroundClick = useCallback(() => {
    if (isMobile()) return
    goToView('tv')
  }, [goToView])

  // Sits over the canvas, so its click would otherwise bubble to
  // handleBackgroundClick and yank the camera on the way out.
  //
  // The face peels off like a sticker, and the navigation waits for it —
  // otherwise the store answers first on a quick connection and the peel is
  // never seen. Slightly under the animation, so the new page takes over
  // while it is still coming away rather than after it has gone.
  const [leaving, setLeaving] = useState(false)
  const leavingRef = useRef(false)
  const foldRef = useRef(null) // clips the face to what is still stuck
  const liftedRef = useRef(null) // clips the backing to what has lifted
  const flapRef = useRef(null) // folds that lifted part back over the face

  // Driven by hand rather than by CSS: the fold edge and the reflection have
  // to move in step, and one of them is an attribute CSS can't animate.
  // Writing both straight to the DOM also keeps it off React's render path.
  const runPeel = useCallback(() => {
    const fold = foldRef.current
    const lifted = liftedRef.current
    const flap = flapRef.current
    if (!fold || !lifted || !flap) return
    const t0 = performance.now()

    const frame = (now) => {
      const p = Math.min(1, (now - t0) / PEEL_MS)
      // Slow to start, as a thumbnail catches the edge, then away.
      const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2
      const t = PEEL_REST + eased * (PEEL_SPAN - PEEL_REST)
      fold.setAttribute('x', t)
      lifted.setAttribute('width', CLIP_BACK + t)
      flap.setAttribute(
        'transform',
        `translate(${t * (1 + PEEL_CURL)} 0) scale(${-PEEL_CURL} 1)`,
      )
      if (p < 1) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, [])

  const handleExit = useCallback((ev) => {
    ev.stopPropagation()
    if (leavingRef.current) return // a second tap mid-peel is not a second exit
    leavingRef.current = true
    setLeaving(true)

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (still) {
      leaveForStore()
      return
    }
    runPeel()
    setTimeout(leaveForStore, PEEL_NAV_MS)
  }, [runPeel])

  // Mobile: native DOM click for iOS audio unlock (no DeviceMotion needed)
  useEffect(() => {
    if (!isMobile()) return

    const handleNativeClick = () => {
      // Resume the context the static hiss plays through. This used to build
      // a throwaway one and drop it, which unlocked nothing.
      try {
        const ctx = audioContext()
        if (ctx && ctx.state === 'suspended') ctx.resume()
      } catch {
        /* no audio on this device */
      }
      unlockAudio()
      document.removeEventListener('click', handleNativeClick)
    }

    document.addEventListener('click', handleNativeClick)
    return () => document.removeEventListener('click', handleNativeClick)
  }, [])

  return (
    <div id="canvas-container" onClick={handleBackgroundClick}>
      <button
        type="button"
        className={`tv-exit${leaving ? ' is-leaving' : ''}`}
        onClick={handleExit}
        aria-label="Back to the store"
      >
        {/* The face, cut to a circle with a transparent surround so none of
            the original's black background shows against the white scene.
            See PEEL_ANGLE above for how the two halves work. */}
        <svg viewBox="0 0 160 160" aria-hidden="true" focusable="false">
          <defs>
            {/* Ahead of the fold: still stuck. */}
            <clipPath id="tv-exit-stuck">
              <rect ref={foldRef} x={PEEL_REST} y="-200" width={CLIP_BACK} height="560" />
            </clipPath>

            {/* Behind the fold: lifted. */}
            <clipPath id="tv-exit-lifted">
              <rect
                ref={liftedRef}
                x={-CLIP_BACK}
                y="-200"
                width={CLIP_BACK + PEEL_REST}
                height="560"
              />
            </clipPath>

            {/* Sticker paper, lit along the roll: brightest where it turns
                over at the fold, falling away toward the loose edge. */}
            <linearGradient id="tv-exit-backing" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#aaa49a" />
              <stop offset="26%" stopColor="#e6e2da" />
              <stop offset="62%" stopColor="#f7f5f1" />
              <stop offset="100%" stopColor="#cfc9bf" />
            </linearGradient>

            {/* Rounds the two corners the crease leaves on a circle, and
                drops the curl's shadow onto what's still stuck. Blur, then
                drive the alpha back to hard: straight edges come through
                unchanged, corners come back round. */}
            <filter id="tv-exit-curl" x="-70%" y="-70%" width="260%" height="260%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="soft" />
              <feColorMatrix
                in="soft"
                type="matrix"
                values="1 0 0 0 0
                        0 1 0 0 0
                        0 0 1 0 0
                        0 0 0 20 -9"
                result="firm"
              />
              <feDropShadow in="firm" dx="2" dy="3" stdDeviation="2.6" floodOpacity="0.36" />
            </filter>
          </defs>

          <g transform={`rotate(${PEEL_ANGLE} 80 80)`}>
            {/* Still stuck down. */}
            <g clipPath="url(#tv-exit-stuck)">
              <g transform={`rotate(${-PEEL_ANGLE} 80 80)`}>
                <image
                  href={`${import.meta.env.BASE_URL}tv-ui-assets/img/back-face.webp`}
                  x="0"
                  y="0"
                  width="160"
                  height="160"
                />
              </g>
            </g>

            {/* Lifted, rolled back over the face, backing side up. */}
            <g className="tv-exit-flap" filter="url(#tv-exit-curl)">
              <g
                ref={flapRef}
                transform={`translate(${PEEL_REST * (1 + PEEL_CURL)} 0) scale(${-PEEL_CURL} 1)`}
              >
                <g clipPath="url(#tv-exit-lifted)">
                  <circle cx="80" cy="80" r="79.5" fill="url(#tv-exit-backing)" />
                </g>
              </g>
            </g>
          </g>
        </svg>
      </button>

      <Canvas
        camera={{ position: [12.02, 3.64, -26.01], fov: 45 }}
        shadows={!isMobile()}
        dpr={isMobile() ? [1, 1.5] : [1, 2]}
        gl={{ antialias: !isMobile(), toneMapping: 3 }}
      >
        <SheetProvider sheet={sheet}>
          <SceneLights />

          <Suspense fallback={<Loader />}>
            <Environment preset="studio" />
            <Model
              controlsRef={controlsRef}
              onGoTo={goToView}
              onAnimationEnd={handleModelAnimEnd}
              onReady={() => {
                const ctrl = controlsRef.current
                const mobile = isMobile()
                if (ctrl) {
                  const p = mobile ? MOBILE_DEFAULT.position : HARDCODED_DEFAULT.position
                  const t = mobile ? MOBILE_DEFAULT.target : HARDCODED_DEFAULT.target
                  ctrl.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false)
                }
                // GPU warmup behind overlay — event-driven reveal (no fixed timeouts)
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      if (mobile) {
                        // Mobile: play animation once; reveal when 'finished' fires
                        onAnimEndCallbackRef.current = () => {
                          // Stop anim so nodes reset during fade, then restart after reveal
                          useChannelStore.setState({ animationPlaying: false })
                          setOverlayFading(true)
                          setTimeout(() => {
                            setLoaded(true)
                            setTimeout(() => useChannelStore.setState({ animationPlaying: true }), 100)
                          }, 700)
                        }
                        useChannelStore.setState({ animationPlaying: true })
                      } else {
                        // Desktop: same as mobile — play animation once behind overlay,
                        // then replay visibly after reveal
                        onAnimEndCallbackRef.current = () => {
                          useChannelStore.setState({ animationPlaying: false })
                          setOverlayFading(true)
                          setTimeout(() => {
                            setLoaded(true)
                            setTimeout(() => useChannelStore.setState({ animationPlaying: true }), 100)
                          }, 700)
                        }
                        useChannelStore.setState({ animationPlaying: true })
                      }
                    })
                  })
                })
              }}
            />
          </Suspense>

          <CameraControls
            ref={controlsRef}
            makeDefault
            minDistance={0.5}
            maxDistance={100}
            smoothTime={0.25}
            draggingSmoothTime={0.1}
            enabled={!isMobile()}
          />

          <WASDControls controlsRef={controlsRef} />
          <FpsTracker fpsRef={fpsRef} />
          <Stats className="fps-stats" />

          {/* Screen-space remote along the bottom edge; waits for the reveal
              so it slides in rather than being there from the first frame. */}
          {loaded && <RemoteHud />}
        </SheetProvider>
      </Canvas>

      {loaded && panelVisible && (
        <CameraPanel controlsRef={controlsRef} onGoTo={goToView} fpsRef={fpsRef} logRef={logRef} />
      )}

      {animDone && !isMobile() && (
        <aside
          className={`sticky-note${stickyFalling ? ' falling' : ''}`}
          onClick={(e) => { e.stopPropagation(); setStickyFalling(true) }}
          onAnimationEnd={(e) => { if (e.animationName === 'fall-off') setAnimDone(false) }}
        >
          <p className="sticky-title">KEYBOARD CONTROLS</p>
          <table>
            <tbody>
              <tr><td><span className="key">O</span></td><td>TV On / Off</td></tr>
              <tr><td><span className="key">M</span></td><td>Mute</td></tr>
              <tr><td><span className="key">+</span></td><td>Volume Up</td></tr>
              <tr><td><span className="key">−</span></td><td>Volume Down</td></tr>
            </tbody>
          </table>
        </aside>
      )}

      {!loaded && (
        <div className={`loading-overlay${overlayFading ? ' fade-out' : ''}`}>
          <LogoAnimation />
        </div>
      )}
    </div>
  )
}

export default App
