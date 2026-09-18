import { useMemo, useEffect, useState, useCallback } from 'react'
import { RoundedBox } from '@react-three/drei'
import { CanvasTexture, SRGBColorSpace, LinearFilter } from 'three'
import useChannelStore from './store'

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

const glyphCache = new Map()

function glyphTexture(ch) {
  if (glyphCache.has(ch)) return glyphCache.get(ch)
  const S = 128
  const cv = document.createElement('canvas')
  cv.width = S
  cv.height = S
  const c = cv.getContext('2d')
  c.clearRect(0, 0, S, S)
  c.fillStyle = 'rgba(16,16,16,0.9)'
  c.font = `700 ${ch === '+' || ch === '−' ? 92 : 74}px "Helvetica Neue", Helvetica, Arial, sans-serif`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(ch, S / 2, S / 2 + 4)
  const t = new CanvasTexture(cv)
  t.colorSpace = SRGBColorSpace
  t.minFilter = LinearFilter
  t.magFilter = LinearFilter
  t.anisotropy = 4
  glyphCache.set(ch, t)
  return t
}

const PRESS_DEPTH = 0.022
const PRESS_MS = 130

// Shared press behaviour: sink the button, fire the action, pop back.
function usePress(onPress) {
  const [pressed, setPressed] = useState(false)

  const down = useCallback(
    (e) => {
      // Keep the tap off the camera controls underneath.
      e.stopPropagation()
      if (!onPress) return
      setPressed(true)
      onPress()
      setTimeout(() => setPressed(false), PRESS_MS)
    },
    [onPress],
  )

  return [pressed ? PRESS_DEPTH : 0, down, !!onPress]
}

function RoundButton({ position, r = 0.075, mat = RUBBER, onPress }) {
  const [sink, down, live] = usePress(onPress)
  const [x, y, z] = position

  return (
    <mesh
      position={[x, y - sink, z]}
      castShadow
      onPointerDown={down}
      onPointerOver={live ? () => (document.body.style.cursor = 'pointer') : undefined}
      onPointerOut={live ? () => (document.body.style.cursor = 'auto') : undefined}
    >
      <cylinderGeometry args={[r, r * 0.92, BTN_H, 20]} />
      <meshStandardMaterial {...mat} />
    </mesh>
  )
}

function PillButton({ position, w = 0.2, l = 0.12, mat = RUBBER, onPress, glyph }) {
  const [sink, down, live] = usePress(onPress)
  const [x, y, z] = position
  const hover = live
    ? {
        onPointerOver: () => (document.body.style.cursor = 'pointer'),
        onPointerOut: () => (document.body.style.cursor = 'auto'),
      }
    : {}

  return (
    <group position={[x, y - sink, z]}>
      <RoundedBox
        args={[w, BTN_H, l]}
        radius={BTN_H * 0.45}
        smoothness={3}
        castShadow
        onPointerDown={down}
        {...hover}
      >
        <meshStandardMaterial {...mat} />
      </RoundedBox>

      {/* Printed on the button top rather than the shell, so it rides down
          with the press instead of being occluded by the button. */}
      {glyph && (
        <mesh position={[0, BTN_H / 2 + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <planeGeometry args={[0.1, 0.1]} />
          <meshBasicMaterial map={glyphTexture(glyph)} transparent depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}

// Printed labels are drawn into a canvas and laid over the shell face as a
// decal. It reads world coordinates straight off the button constants below,
// so labels and buttons can never drift apart — move a button, the label moves.
const LABEL_PX_PER_UNIT = 600

function worldToCanvas(x, z) {
  return [
    ((x + BODY.w / 2) / BODY.w) * BODY.w * LABEL_PX_PER_UNIT,
    ((z + BODY.l / 2) / BODY.l) * BODY.l * LABEL_PX_PER_UNIT,
  ]
}

function buildLabelTexture(keypad) {
  const W = Math.round(BODY.w * LABEL_PX_PER_UNIT)
  const H = Math.round(BODY.l * LABEL_PX_PER_UNIT)
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const c = cv.getContext('2d')

  c.clearRect(0, 0, W, H)
  c.textAlign = 'center'
  c.textBaseline = 'middle'

  const text = (str, x, z, size, color = 'rgba(224,224,224,0.85)', weight = '600') => {
    const [px, py] = worldToCanvas(x, z)
    c.fillStyle = color
    c.font = `${weight} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    c.fillText(str, px, py)
  }

  // Keypad digits, printed just under each button.
  keypad.forEach(({ x, z, label }) => text(label, x, z + 0.105, 30))

  // Power / mute
  text('POWER', -0.22, -0.79, 19, 'rgba(232,150,140,0.9)')
  text('MUTE', 0.22, -0.79, 19)

  // Rockers: channel on the left, volume on the right. No up/down glyphs —
  // the decal sits below the button tops, so anything drawn under a button
  // is occluded by it.
  text('CH', -0.21, -0.335, 21)
  text('VOL', 0.21, -0.335, 21)

  const tex = new CanvasTexture(cv)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.anisotropy = 4
  return tex
}

export default function Remote(props) {
  // 3x4 keypad: 1-9 then blank/0/enter, laid out from the middle of the body.
  const keypad = useMemo(() => {
    const cols = [-0.21, 0, 0.21]
    const rows = [-0.12, 0.13, 0.38, 0.63]
    const labels = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], [null, '0', 'ENT']]
    const keys = []
    rows.forEach((z, r) => {
      cols.forEach((x, c) => {
        // bottom row is blank / 0 / enter — skip the blank slot
        if (labels[r][c] === null) return
        keys.push({ x, z, key: `${r}-${c}`, label: labels[r][c] })
      })
    })
    return keys
  }, [])

  const labelTexture = useMemo(() => buildLabelTexture(keypad), [keypad])
  useEffect(() => () => labelTexture.dispose(), [labelTexture])

  // Every button drives the same store the keyboard shortcuts drive, so the
  // remote, the keys and (later) a phone all stay in sync for free.
  const togglePower = useChannelStore((s) => s.togglePower)
  const nextChannel = useChannelStore((s) => s.nextChannel)
  const prevChannel = useChannelStore((s) => s.prevChannel)
  const volumeUp = useChannelStore((s) => s.volumeUp)
  const volumeDown = useChannelStore((s) => s.volumeDown)
  const toggleMute = useChannelStore((s) => s.toggleMute)
  const enterChannelNumber = useChannelStore((s) => s.enterChannelNumber)

  // Channel/volume only mean anything once the set is on.
  const whenOn = useCallback(
    (fn) => () => {
      if (useChannelStore.getState().phase === 'off') return
      fn()
    },
    [],
  )

  const pressDigit = useCallback(
    (label) => () => {
      if (useChannelStore.getState().phase === 'off') return
      if (label === 'ENT') return
      enterChannelNumber(Number(label))
    },
    [enterChannelNumber],
  )

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

      {/* Printed labels, laid on the face just under the button tops */}
      <mesh position={[0, FACE_Y + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BODY.w, BODY.l]} />
        <meshBasicMaterial map={labelTexture} transparent depthWrite={false} />
      </mesh>

      {/* IR emitter window at the tip */}
      <mesh position={[0, FACE_Y - 0.04, -BODY.l / 2 + 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.26, 0.1]} />
        <meshStandardMaterial {...EMITTER} />
      </mesh>

      {/* Power, top-left; the one red button on the whole thing */}
      <RoundButton position={[-0.22, FACE_Y, -0.92]} r={0.082} mat={POWER} onPress={togglePower} />

      {/* Mute, top-right */}
      <RoundButton
        position={[0.22, FACE_Y, -0.92]}
        r={0.072}
        mat={RUBBER_LIGHT}
        onPress={whenOn(toggleMute)}
      />

      {/* Channel rocker (left) and volume rocker (right) — two pills each,
          split by a thin gap so they read as a single rocker switch. */}
      <PillButton position={[-0.21, FACE_Y, -0.62]} w={0.26} l={0.13} mat={RUBBER_LIGHT} onPress={whenOn(nextChannel)} glyph="▲" />
      <PillButton position={[-0.21, FACE_Y, -0.46]} w={0.26} l={0.13} mat={RUBBER_LIGHT} onPress={whenOn(prevChannel)} glyph="▼" />
      <PillButton position={[0.21, FACE_Y, -0.62]} w={0.26} l={0.13} mat={RUBBER_LIGHT} onPress={whenOn(volumeUp)} glyph="+" />
      <PillButton position={[0.21, FACE_Y, -0.46]} w={0.26} l={0.13} mat={RUBBER_LIGHT} onPress={whenOn(volumeDown)} glyph="−" />

      {/* Number pad */}
      {keypad.map(({ x, z, key, label }) => (
        <RoundButton key={key} position={[x, FACE_Y, z]} r={0.068} onPress={pressDigit(label)} />
      ))}

      {/* Battery door seam on the underside */}
      <mesh position={[0, -FACE_Y + 0.001, 0.72]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.52, 0.86]} />
        <meshStandardMaterial color="#0e0e0e" roughness={0.7} />
      </mesh>
    </group>
  )
}
