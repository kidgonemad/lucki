import { useRef, useState, useEffect } from 'react'
import { Hud, OrthographicCamera } from '@react-three/drei'
import { useThree, useFrame } from '@react-three/fiber'
import Remote from './Remote'

/**
 * The remote as a screen-space overlay, lying horizontally along the bottom
 * edge. It renders inside the main Canvas via <Hud>, so there's no second
 * WebGL context — just a second camera pass over the same renderer.
 *
 * The ortho camera is set up so 1 world unit == 1 CSS pixel, which makes the
 * layout numbers below read as plain pixel values.
 */

const REMOTE_PX = 300 // on-screen length of the remote, in px
const MARGIN_PX = 26 // gap from the bottom edge at rest
const SLIDE_PX = 260 // how far below the edge it starts
const EASE = 2.6 // higher = snappier settle

function RemoteRig() {
  const group = useRef()
  const { size } = useThree()
  const [armed, setArmed] = useState(false)

  // Small beat before it slides in, so it arrives after the scene settles
  // rather than competing with the load.
  useEffect(() => {
    const t = setTimeout(() => setArmed(true), 900)
    return () => clearTimeout(t)
  }, [])

  const scale = REMOTE_PX / 2.4 // remote is 2.4 units long in local space
  const restY = -size.height / 2 + (0.86 * scale) / 2 + MARGIN_PX

  useFrame((_, delta) => {
    if (!group.current) return
    const target = armed ? restY : restY - SLIDE_PX
    // Frame-rate independent exponential ease toward the target.
    const k = 1 - Math.exp(-EASE * delta)
    group.current.position.y += (target - group.current.position.y) * k
  })

  return (
    <group ref={group} position={[0, restY - SLIDE_PX, 0]} scale={scale}>
      {/* Spin it flat on screen... */}
      <group rotation={[0, 0, Math.PI / 2]}>
        {/* ...and tip the face toward the camera. The face normal is +Y in
            the remote's local space, so +90° about X swings it to +Z. */}
        <group rotation={[Math.PI / 2, 0, 0]}>
          <Remote />
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
