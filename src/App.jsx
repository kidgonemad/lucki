import { Suspense, useRef, useState, useCallback, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { CameraControls, Environment, Stats } from '@react-three/drei'
import { Vector3 } from 'three'
import { getProject } from '@theatre/core'
import studio from '@theatre/studio'
import extension from '@theatre/r3f/dist/extension'
import { editable as e, SheetProvider } from '@theatre/r3f'
import Model from './Model'
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

// Click sound for channel/volume actions
const clickSound = typeof Audio !== 'undefined' ? new Audio(`${import.meta.env.BASE_URL}tv-ui-assets/sounds/remote-click.mp3`) : null
function playClick() {
  if (!clickSound) return
  clickSound.currentTime = 0
  clickSound.play().catch(() => {})
}

function App() {
  const controlsRef = useRef()
  const tvHoverRef = useRef(false)
  const [panelVisible, setPanelVisible] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [overlayFading, setOverlayFading] = useState(false)
  const mobileTapRef = useRef(0) // mobile tap sequence: 0=ready, 1=zoomed in, 2=tv on

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

      // Camera controls always work
      if (e.key === 'h' || e.key === 'H') {
        setPanelVisible((v) => {
          const next = !v
          // Toggle stats
          document.querySelectorAll('.fps-stats').forEach(el => el.classList.toggle('show', next))
          // Toggle Theatre.js studio (dev only)
          if (import.meta.env.DEV) {
            if (next) studio.ui.restore()
            else studio.ui.hide()
          }
          return next
        })
        return
      }
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

      // Animation toggle
      if (e.key === 'l' || e.key === 'L') {
        logEvent('Anim toggle')
        s.toggleAnimation()
        return
      }

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

  // Mobile: native DOM click for iOS audio unlock (no DeviceMotion needed)
  useEffect(() => {
    if (!isMobile()) return

    const handleNativeClick = () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        if (ctx.state === 'suspended') ctx.resume()
      } catch (_) {}
      document.removeEventListener('click', handleNativeClick)
    }

    document.addEventListener('click', handleNativeClick)
    return () => document.removeEventListener('click', handleNativeClick)
  }, [])

  return (
    <div id="canvas-container" onClick={() => {
      if (!isMobile()) {
        goToView('tv')
      } else {
        // Mobile 3-tap sequence (R3F onClick disabled — no raycasting)
        const tap = mobileTapRef.current
        if (tap === 0) {
          useChannelStore.setState({ isMuted: false, volume: 1.0 })
          useChannelStore.getState().togglePower()
          goToView('tv')
          mobileTapRef.current = 1
        } else if (tap === 1) {
          goToView('default')
          mobileTapRef.current = 2
        } else if (tap === 2) {
          const s = useChannelStore.getState()
          if (s.tvOn) s.togglePower()
          mobileTapRef.current = 0
        }
      }
    }}>
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
              onReady={() => {
                const ctrl = controlsRef.current
                const mobile = isMobile()
                if (ctrl) {
                  const p = mobile ? MOBILE_DEFAULT.position : HARDCODED_DEFAULT.position
                  const t = mobile ? MOBILE_DEFAULT.target : HARDCODED_DEFAULT.target
                  ctrl.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, false)
                }
                // GPU warmup behind overlay
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      if (mobile) {
                        useChannelStore.setState({ animationPlaying: true })
                        // Fade overlay at 4.5s, reveal at 5.2s
                        setTimeout(() => setOverlayFading(true), 4500)
                        setTimeout(() => setLoaded(true), 5200)
                        // Stop animation AFTER overlay gone so GPU stays warm for first L press
                        setTimeout(() => {
                          useChannelStore.setState({ animationPlaying: false })
                        }, 5500)
                      } else {
                        // Desktop warmup: camera to TV + animation, both stay alive past overlay lift
                        useChannelStore.setState({ animationPlaying: true })
                        if (ctrl) {
                          ctrl.smoothTime = 0.7
                          ctrl.setLookAt(
                            TV_CLOSE_UP.position.x, TV_CLOSE_UP.position.y, TV_CLOSE_UP.position.z,
                            TV_CLOSE_UP.target.x, TV_CLOSE_UP.target.y, TV_CLOSE_UP.target.z,
                            true
                          )
                        }
                        setTimeout(() => {
                          if (ctrl) {
                            ctrl.setLookAt(
                              HARDCODED_DEFAULT.position.x, HARDCODED_DEFAULT.position.y, HARDCODED_DEFAULT.position.z,
                              HARDCODED_DEFAULT.target.x, HARDCODED_DEFAULT.target.y, HARDCODED_DEFAULT.target.z,
                              true
                            )
                          }
                        }, 1500)
                        setTimeout(() => { if (ctrl) ctrl.smoothTime = 0.25 }, 2500)
                        setTimeout(() => setOverlayFading(true), 4000)
                        setTimeout(() => setLoaded(true), 4600)
                        // Stop animation AFTER overlay gone — GPU stays warm for first L press
                        setTimeout(() => {
                          useChannelStore.setState({ animationPlaying: false })
                        }, 4800)
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
        </SheetProvider>
      </Canvas>

      {loaded && panelVisible && (
        <CameraPanel controlsRef={controlsRef} onGoTo={goToView} fpsRef={fpsRef} logRef={logRef} />
      )}

      {!loaded && (
        <div className={`loading-overlay${overlayFading ? ' fade-out' : ''}`}>
          <img src={`${import.meta.env.BASE_URL}assets/logo.gif`} alt="Loading" className="loading-logo" />
        </div>
      )}
    </div>
  )
}

export default App
