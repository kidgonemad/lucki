import { forwardRef, Suspense, useState, useEffect, useRef } from 'react'
import { RenderTexture, OrthographicCamera, Text } from '@react-three/drei'
import { MeshBasicMaterial, LinearFilter } from 'three'
import useChannelStore from './store'

const FONT_URL = '/tv-ui-assets/fonts/retro-tv-font.otf'
const UI_COLOR = '#FFFFFF'

const textMaterial = new MeshBasicMaterial({ color: UI_COLOR, toneMapped: false })

const textProps = {
  font: FONT_URL,
  fontSize: 0.7,
  anchorY: 'top',
  outlineOffsetX: '4%',
  outlineOffsetY: '4%',
  outlineColor: '#000000',
  material: textMaterial,
  color: UI_COLOR,
}

// --- Channel Number (top-right, 3-digit) ---
function ChannelNumber({ timeout = 2 }) {
  const inProgress = useChannelStore((s) => s.inProgressChannelNumber)
  const channel = useChannelStore((s) => s.currentChannel)
  const [visible, setVisible] = useState(true)
  const timer = useRef(null)

  const padChar = inProgress ? '-' : '0'
  const displayNum = inProgress || channel
  const displayText = displayNum.toString().padStart(3, padChar)

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 3000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    setVisible(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(false), timeout * 1000)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [inProgress, channel, timeout])

  if (!visible) return null

  return (
    <Text
      {...textProps}
      textAlign="right"
      anchorX="right"
      maxWidth={3}
      position={[7.5, 5.5, 0]}
    >
      {displayText}
    </Text>
  )
}

// --- Volume / Mute Display (top-left + bar) ---
function VolumeDisplay({ timeout = 2 }) {
  const [visible, setVisible] = useState(false)
  const hideTimer = useRef(null)
  const volume = useChannelStore((s) => s.volume)
  const isMuted = useChannelStore((s) => s.isMuted)
  const upCount = useChannelStore((s) => s.volumeUpCount)
  const downCount = useChannelStore((s) => s.volumeDownCount)
  const mutedCount = useChannelStore((s) => s.mutedCount)
  const setDisplaying = useChannelStore((s) => s.setIsVolumeBeingDisplayed)
  const [initialized, setInitialized] = useState(false)

  const filledBars = Math.ceil(20 * Number(volume.toFixed(2)))

  useEffect(() => {
    if (!initialized) { setInitialized(true); return }
    setVisible(true)
    setDisplaying(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      setVisible(false)
      setDisplaying(false)
    }, timeout * 1000)
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current) }
  }, [volume, isMuted, upCount, downCount, mutedCount, timeout, setDisplaying])

  if (!visible) return null

  const bars = Array(20).fill(null).map((_, i) => (
    <mesh key={i} position={[i * 0.35, 0, 0]}>
      <planeGeometry args={i < filledBars ? [0.22, 0.6] : [0.1, 0.1]} />
      <meshBasicMaterial color={UI_COLOR} toneMapped={false} />
    </mesh>
  ))

  return (
    <>
      <Text
        {...textProps}
        textAlign="left"
        anchorX="left"
        maxWidth={10}
        position={[-7.5, 5.5, 0.001]}
      >
        {isMuted ? 'MUTE' : 'VOLUME'}
      </Text>
      {!isMuted && (
        <group position={[-7.0, 4.2, 0.001]}>
          <Text {...textProps} textAlign="right" anchorX="right" position={[-0.3, 0, 0]}>
            -
          </Text>
          <group position={[0.3, -0.35, 0]}>
            {bars}
          </group>
          <Text {...textProps} textAlign="left" anchorX="left" position={[7.4, 0, 0]}>
            +
          </Text>
        </group>
      )}
    </>
  )
}

// --- No Signal (center) ---
function NoSignal() {
  const noSignal = useChannelStore((s) => s.noSignal)
  const channels = useChannelStore((s) => s.channels)
  const count = Object.keys(channels).length

  if (!noSignal) return null

  return (
    <Text
      {...textProps}
      fontSize={0.7}
      anchorY="middle"
      textAlign="center"
      anchorX="center"
      lineHeight={1.4}
      maxWidth={15}
      position={[0, 0, 0]}
    >
      {`NO SIGNAL\nTRY CHANNELS 1-${count}`}
    </Text>
  )
}

// --- Buffering (top-left) ---
function Buffering() {
  const buffering = useChannelStore((s) => s.buffering)
  const volDisplayed = useChannelStore((s) => s.isVolumeBeingDisplayed)

  if (!buffering || volDisplayed) return null

  return (
    <Text
      {...textProps}
      textAlign="left"
      anchorX="left"
      position={[-7.5, 5.5, 0.001]}
    >
      BUFFERING
    </Text>
  )
}

// --- Main TVUI (RenderTexture) ---
const TVUI = forwardRef(function TVUI(props, ref) {
  const phase = useChannelStore((s) => s.phase)

  return (
    <RenderTexture
      ref={ref}
      width={800}
      height={600}
      samples={1}
      stencilBuffer={false}
      generateMipmaps={false}
      minFilter={LinearFilter}
      magFilter={LinearFilter}
    >
      <OrthographicCamera
        makeDefault
        manual
        left={-1}
        right={1}
        top={0.75}
        bottom={-0.75}
        near={0.1}
        far={2}
        position={[0, 0, 1]}
      />
      <Suspense fallback={null}>
        <group scale={[0.105, 0.105, 0.105]} position={[0, 0.02, 0]}>
          {phase !== 'off' && <VolumeDisplay timeout={2} />}
          {phase === 'channels' && (
            <>
              <ChannelNumber timeout={2} />
              <NoSignal />
              <Buffering />
            </>
          )}
        </group>
      </Suspense>
    </RenderTexture>
  )
})

export default TVUI
