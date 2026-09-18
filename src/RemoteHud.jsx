import { useRef, useState, useEffect } from 'react'
import { Hud, OrthographicCamera } from '@react-three/drei'
import { useThree, useFrame } from '@react-three/fiber'
import Remote from './Remote'

/**
 * The remote as a screen-space overlay, held upright as though an invisible
 * hand were holding it out: it drifts, sways and breathes rather than sitting
 * locked to the edge.
 *
 * It renders inside the main Canvas via <Hud>, so there's no second WebGL
 * context — just a second camera pass over the same renderer. The ortho camera
 * is set up so 1 world unit == 1 CSS pixel, which makes the layout numbers
 * below read as plain pixel values.
 */

const REMOTE_PX = 300 // on-screen length of the remote, in px
const MARGIN_X = 74 // from the right edge
const MARGIN_Y = 40 // from the bottom edge
const SLIDE_PX = 300 // how far below the edge it starts

// A hand never holds anything perfectly square to you.
const REST_TILT_X = 0.26
const REST_TILT_Z = -0.11

// Idle motion. Deliberately unrelated frequencies so the loop never reads as
// a loop — a hand doesn't oscillate on a metronome.
const DRIFT = {
  y: { amp: 9, hz: 0.27 },
  x: { amp: 5, hz: 0.19 },
  rotZ: { amp: 0.045, hz: 0.23 },
  rotX: { amp: 0.035, hz: 0.31 },
  rotY: { amp: 0.06, hz: 0.13 },
}

function RemoteRig() {
  const group = useRef()
  const inner = useRef()
  const { size } = useThree()
  const [armed, setArmed] = useState(false)
  const t = useRef(0)

  // Small beat before it rises into frame, so it arrives after the scene
  // settles rather than competing with the load.
  useEffect(() => {
    const id = setTimeout(() => setArmed(true), 900)
    return () => clearTimeout(id)
  }, [])

  const scale = REMOTE_PX / 2.4 // remote is 2.4 units long in local space
  const restX = size.width / 2 - (0.86 * scale) / 2 - MARGIN_X
  const restY = -size.height / 2 + REMOTE_PX / 2 + MARGIN_Y

  useFrame((_, delta) => {
    if (!group.current || !inner.current) return
    t.current += delta

    // Rise into frame once, then hold.
    const targetY = armed ? restY : restY - SLIDE_PX
    const k = 1 - Math.exp(-2.6 * delta)
    group.current.position.y += (targetY - group.current.position.y) * k
    group.current.position.x += (restX - group.current.position.x) * k

    // The held-in-hand drift, layered on top of wherever the rise has got to.
    const time = t.current
    const w = (d) => Math.sin(time * d.hz * Math.PI * 2)
    inner.current.position.y = DRIFT.y.amp * w(DRIFT.y)
    inner.current.position.x = DRIFT.x.amp * w(DRIFT.x)
    inner.current.rotation.z = REST_TILT_Z + DRIFT.rotZ.amp * w(DRIFT.rotZ)
    inner.current.rotation.x = REST_TILT_X + DRIFT.rotX.amp * w(DRIFT.rotX)
    inner.current.rotation.y = DRIFT.rotY.amp * w(DRIFT.rotY)
  })

  return (
    <group ref={group} position={[restX, restY - SLIDE_PX, 0]}>
      {/* Drift lives on its own node so it composes with the rise instead of
          fighting it for the same transform. */}
      <group ref={inner}>
        <group scale={scale}>
          {/* Upright, face toward the camera. The remote's face normal is +Y
              in local space, so +90° about X swings it to +Z. */}
          <group rotation={[Math.PI / 2, 0, 0]}>
            <Remote />
          </group>
        </group>
      </group>
    </group>
  )
}

export default function RemoteHud() {
  const { size } = useThree()

  // Mobile only — portrait aspect, matching isMobile() in App.jsx. Derived
  // straight from the live canvas size, so rotating a phone or resizing a
  // window re-evaluates it with no state to keep in sync.
  if (size.width / size.height >= 1) return null

  return (
    <Hud renderPriority={2}>
      <OrthographicCamera
        makeDefault
        left={-size.width / 2}
        right={size.width / 2}
        top={size.height / 2}
        bottom={-size.height / 2}
        near={-1000}
        far={1000}
        position={[0, 0, 100]}
      />
      <ambientLight intensity={1.1} />
      <directionalLight position={[120, 300, 200]} intensity={2.4} />
      <directionalLight position={[-200, 120, 80]} intensity={0.9} />
      <RemoteRig />
    </Hud>
  )
}
