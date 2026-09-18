import { useMemo } from 'react'
import { RoundedBox } from '@react-three/drei'

/**
 * Procedural CRT-era TV remote. No external model — everything here is built
 * from boxes and cylinders so the mesh ships with the bundle and carries no
 * license of its own.
 *
 * Local space: X = width, Y = thickness, Z = length (tip at -Z, base at +Z).
 * Unit length is ~2.4, so scale to taste at the call site.
 */

const BODY = { w: 0.86, h: 0.2, l: 2.4 }

// Matched to the materials already in the TV/VCR GLB so the remote reads as
// part of the same set: dark textured plastic shell, softer rubber buttons.
const SHELL = { color: '#1f1f1f', roughness: 0.55, metalness: 0.08 }
const RUBBER = { color: '#454545', roughness: 0.85, metalness: 0.0 }
const RUBBER_LIGHT = { color: '#585858', roughness: 0.85, metalness: 0.0 }
const POWER = { color: '#a82219', roughness: 0.6, metalness: 0.0 }
const EMITTER = { color: '#3a2a12', roughness: 0.35, metalness: 0.1 }

// Buttons sit just proud of the shell's top face.
const FACE_Y = BODY.h / 2
const BTN_H = 0.045

function RoundButton({ position, r = 0.075, mat = RUBBER }) {
  return (
    <mesh position={position} castShadow>
      <cylinderGeometry args={[r, r * 0.92, BTN_H, 20]} />
      <meshStandardMaterial {...mat} />
    </mesh>
  )
}

function PillButton({ position, w = 0.2, l = 0.12, mat = RUBBER }) {
  return (
    <RoundedBox
      args={[w, BTN_H, l]}
      radius={BTN_H * 0.45}
      smoothness={3}
      position={position}
      castShadow
    >
      <meshStandardMaterial {...mat} />
    </RoundedBox>
  )
}

export default function Remote(props) {
  // 3x4 keypad: 1-9 then blank/0/enter, laid out from the middle of the body.
  const keypad = useMemo(() => {
    const cols = [-0.21, 0, 0.21]
    const rows = [-0.12, 0.13, 0.38, 0.63]
    const keys = []
    rows.forEach((z, r) => {
      cols.forEach((x, c) => {
        // bottom row is blank / 0 / enter — skip the blank slot
        if (r === 3 && c === 0) return
        keys.push({ x, z, key: `${r}-${c}` })
      })
    })
    return keys
  }, [])

  return (
    <group {...props}>
      {/* Shell */}
      <RoundedBox
        args={[BODY.w, BODY.h, BODY.l]}
        radius={0.09}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial {...SHELL} />
      </RoundedBox>

      {/* IR emitter window at the tip */}
      <mesh position={[0, FACE_Y - 0.04, -BODY.l / 2 + 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.26, 0.1]} />
        <meshStandardMaterial {...EMITTER} />
      </mesh>

      {/* Power, top-left; the one red button on the whole thing */}
      <RoundButton position={[-0.22, FACE_Y, -0.92]} r={0.082} mat={POWER} />

      {/* Mute, top-right */}
      <RoundButton position={[0.22, FACE_Y, -0.92]} r={0.072} mat={RUBBER_LIGHT} />

      {/* Channel rocker (left) and volume rocker (right) — two pills each,
          split by a thin gap so they read as a single rocker switch. */}
      <PillButton position={[-0.21, FACE_Y, -0.62]} w={0.26} l={0.13} mat={RUBBER_LIGHT} />
      <PillButton position={[-0.21, FACE_Y, -0.46]} w={0.26} l={0.13} mat={RUBBER_LIGHT} />
      <PillButton position={[0.21, FACE_Y, -0.62]} w={0.26} l={0.13} mat={RUBBER_LIGHT} />
      <PillButton position={[0.21, FACE_Y, -0.46]} w={0.26} l={0.13} mat={RUBBER_LIGHT} />

      {/* Number pad */}
      {keypad.map(({ x, z, key }) => (
        <RoundButton key={key} position={[x, FACE_Y, z]} r={0.068} />
      ))}

      {/* Battery door seam on the underside */}
      <mesh position={[0, -FACE_Y + 0.001, 0.72]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.52, 0.86]} />
        <meshStandardMaterial color="#0e0e0e" roughness={0.7} />
      </mesh>
    </group>
  )
}
