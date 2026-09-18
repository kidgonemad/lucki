import { useRef, useState, useEffect } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import Remote from './Remote'

/**
 * The remote, pinned in front of the camera so it behaves like a screen-space
 * overlay while still living in the main scene.
 *
 * It deliberately does NOT use drei's <Hud>: that takes over the render loop
 * via renderPriority, and in this scene the main pass stopped drawing
 * entirely — black screen with only the remote on it. Riding the camera keeps
 * one render pass and no custom loop.
 *
 * It is held upright and drifting, as though an invisible hand were holding
 * it out, rather than locked flat to the edge.
 */

const DIST = 1.2 // metres in front of the camera
const HEIGHT_FRAC = 0.4 // remote length as a fraction of the visible height
const MARGIN_FRAC = 0.09 // inset from the right/bottom edges

// A hand never holds anything perfectly square to you.
const REST_TILT_X = 0.24
const REST_TILT_Z = -0.1

// Idle motion, in local units. Unrelated frequencies so the loop never reads
// as a loop — a hand doesn't oscillate on a metronome.
//
// Amplitudes are half what they were. At the old figures a button wandered up
// to 21px across the screen and 25px down it over a few seconds — further
// than a keypad key is wide, so a button you aimed at had moved by the time
// your thumb landed. Halved, the hand still reads as a hand and the excursion
// lands inside the hit areas in Remote.jsx.
const DRIFT = {
  y: { amp: 0.006, hz: 0.27 },
  x: { amp: 0.0035, hz: 0.19 },
  rotZ: { amp: 0.022, hz: 0.23 },
  rotX: { amp: 0.018, hz: 0.31 },
  rotY: { amp: 0.03, hz: 0.13 },
}

const RISE = 0.5 // how far below its resting spot it starts

export default function RemoteHud() {
  const rig = useRef()
  const inner = useRef()
  const { camera, size } = useThree()
  const [armed, setArmed] = useState(false)
  const t = useRef(0)
  const rise = useRef(RISE)

  // Small beat before it rises into frame, so it arrives after the scene
  // settles rather than competing with the load.
  useEffect(() => {
    const id = setTimeout(() => setArmed(true), 900)
    return () => clearTimeout(id)
  }, [])

  // Draw over the scene rather than intersecting the TV or the trolley.
  useEffect(() => {
    if (!rig.current) return
    rig.current.traverse((o) => {
      if (!o.material) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      mats.forEach((m) => {
        m.depthTest = false
        m.depthWrite = false
      })
      o.renderOrder = 999
    })
  })

  useFrame((_, delta) => {
    if (!rig.current || !inner.current) return
    t.current += delta

    // Visible extent of the frustum at DIST, so the layout adapts to any
    // viewport without hard-coded pixel maths.
    const h = 2 * Math.tan(((camera.fov || 45) * Math.PI) / 360) * DIST
    const w = h * (size.width / size.height)
    const scale = (HEIGHT_FRAC * h) / 2.4 // remote is 2.4 units long

    rise.current += ((armed ? 0 : RISE) - rise.current) * (1 - Math.exp(-2.6 * delta))

    // Ride the camera: sit at a fixed spot in its local space.
    rig.current.position.copy(camera.position)
    rig.current.quaternion.copy(camera.quaternion)
    rig.current.translateX(w / 2 - MARGIN_FRAC * w - (0.86 * scale) / 2)
    rig.current.translateY(-h / 2 + MARGIN_FRAC * h + (2.4 * scale) / 2 - rise.current * h)
    rig.current.translateZ(-DIST)
    rig.current.scale.setScalar(scale)

    // Held-in-hand drift, on its own node so it composes with the rise.
    const time = t.current
    const wv = (d) => Math.sin(time * d.hz * Math.PI * 2)
    inner.current.position.y = (DRIFT.y.amp * wv(DRIFT.y)) / scale
    inner.current.position.x = (DRIFT.x.amp * wv(DRIFT.x)) / scale
    inner.current.rotation.z = REST_TILT_Z + DRIFT.rotZ.amp * wv(DRIFT.rotZ)
    inner.current.rotation.x = REST_TILT_X + DRIFT.rotX.amp * wv(DRIFT.rotX)
    inner.current.rotation.y = DRIFT.rotY.amp * wv(DRIFT.rotY)
  })

  // Mobile only — portrait aspect, matching isMobile() in App.jsx. Derived
  // from the live canvas size, so rotating a phone re-evaluates it.
  if (size.width / size.height >= 1) return null

  return (
    <group ref={rig}>
      <group ref={inner}>
        {/* Upright, face toward the camera. The remote's face normal is +Y in
            local space, so +90° about X swings it to +Z. */}
        <group rotation={[Math.PI / 2, 0, 0]}>
          <Remote />
        </group>
      </group>
    </group>
  )
}
