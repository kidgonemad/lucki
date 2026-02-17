import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useEffect, useRef } from 'react'
import { VideoTexture, SRGBColorSpace, LinearFilter, Color, AnimationMixer, LoopOnce } from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import TvScreenMaterial from './TvScreenMaterial'
import useChannelStore from './store'
import TVUI from './TVUI'

// Set up Draco decoder for compressed GLB
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
const CDN = 'https://pub-48d4141ea8154377b15f818e23442153.r2.dev'
const GLB_URL = `${CDN}/lucki-tv.glb`

useGLTF.preload(GLB_URL, undefined, undefined, (loader) => {
  loader.setDRACOLoader(dracoLoader)
})

export default function Model({ controlsRef, onGoTo, onReady, mobileTapRef, ...props }) {
  const { scene, animations } = useGLTF(GLB_URL, undefined, undefined, (loader) => {
    loader.setDRACOLoader(dracoLoader)
  })
  const mixerRef = useRef(null)
  const actionRef = useRef(null)
  const videoRef = useRef(null)
  const materialRef = useRef(null)
  const tvuiRef = useRef(null)
  const powerTargetRef = useRef(0)
  const lastOffsetRef = useRef(null)

  // Single-pass scene traversal: collect all nodes and apply tint in one walk
  const { tvNode, screenMesh, animNodes, layerGroups, emptyRef } = useMemo(() => {
    let _tvNode = null
    let _screenMesh = null
    const blackMats = new Set(['TVfront', 'Electronics plastic', 'White'])
    const groups = {
      lightBars: [], pipes: [], cylinders: [], cubes: [],
      planes: [], guitarStrap: [], curves: [],
    }
    const extraEnv = []
    const EXTRA_ENV_PREFIXES = ['dc36a', 'Empty', 'Bottom_light', 'Bottom light']

    scene.traverse((child) => {
      const n = child.name
      if (n === 'tv') _tvNode = child
      if (child.isMesh && child.material) {
        if (child.material.name === 'TVScreen') _screenMesh = child
        if (blackMats.has(child.material.name)) child.material.color = new Color(0x000000)
      }
      if (n.startsWith('Bottom_light_bars') || n.startsWith('Bottom light bars')) groups.lightBars.push(child)
      else if (n.startsWith('pipe')) groups.pipes.push(child)
      else if (n.startsWith('Cylinder')) groups.cylinders.push(child)
      else if (n.startsWith('Cube')) groups.cubes.push(child)
      else if (n.startsWith('Plane')) groups.planes.push(child)
      else if (n.includes('Guitar') && n.includes('strap')) groups.guitarStrap.push(child)
      else if (n.startsWith('BezierCurve')) groups.curves.push(child)
      else if (EXTRA_ENV_PREFIXES.some(p => n.startsWith(p))) extraEnv.push(child)
    })

    // Direct-children pass: animNodes + emptyRef
    const ENV_PREFIXES = ['Bottom_light', 'Bottom light', 'pipe', 'Cylinder', 'Cube', 'Plane', 'dc36a', 'Empty', 'BezierCurve']
    const isEnv = (name) => ENV_PREFIXES.some(p => name.startsWith(p))
    const nodes = []
    const origX = []
    let _emptyRef = null
    for (const child of scene.children) {
      if (child.name === 'MODEL__EMPTY') _emptyRef = child
      else if (!isEnv(child.name)) {
        nodes.push(child)
        origX.push(child.position.x)
      }
    }

    return {
      tvNode: _tvNode,
      screenMesh: _screenMesh,
      animNodes: { nodes, origX },
      layerGroups: { groups, extraEnv },
      emptyRef: _emptyRef,
    }
  }, [scene])

  // Set up mixer on MODEL__EMPTY (no reparenting — just read its X for the slide)
  useEffect(() => {
    if (animations.length === 0) return
    const mixer = new AnimationMixer(scene)
    mixerRef.current = mixer
    actionRef.current = mixer.clipAction(animations[0])

    return () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(scene)
      mixerRef.current = null
      actionRef.current = null
    }
  }, [scene, animations])

  // Animation playback toggle
  const animationPlaying = useChannelStore((s) => s.animationPlaying)
  useEffect(() => {
    const action = actionRef.current
    if (!action) return
    if (animationPlaying) {
      action.setLoop(LoopOnce)
      action.clampWhenFinished = true
      action.timeScale = 1.5
      action.reset().play()
    } else {
      action.stop()
    }
  }, [animationPlaying])

  // Sync layer visibility from store
  const layers = useChannelStore((s) => s.layers)
  const envVisible = useChannelStore((s) => s.envVisible)
  useEffect(() => {
    for (const [key, nodes] of Object.entries(layerGroups.groups)) {
      const vis = layers[key]
      for (const node of nodes) node.visible = vis
    }
    // Extra env nodes follow the master env toggle
    for (const node of layerGroups.extraEnv) node.visible = envVisible
  }, [layers, envVisible, layerGroups])

  useEffect(() => { if (onReady) onReady() }, [])

  useEffect(() => {
    if (!screenMesh) return

    let mounted = true

    // --- Create video element ---
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.loop = false
    video.muted = true
    video.playsInline = true
    video.style.display = 'none'
    document.body.appendChild(video)
    videoRef.current = video

    const mobile = window.innerWidth / window.innerHeight < 1

    // Helper: ensure video is unmuted before every play on mobile.
    // Audio unlock happens in handleClick (a real click gesture iOS trusts).
    const mobilePlay = () => {
      if (mobile) {
        video.muted = false
        video.volume = 1.0
      }
      return video.play()
    }

    // --- Create video texture ---
    const videoTexture = new VideoTexture(video)
    videoTexture.colorSpace = SRGBColorSpace
    videoTexture.minFilter = LinearFilter
    videoTexture.magFilter = LinearFilter

    // --- Create CRT material ---
    const crtMat = new TvScreenMaterial({
      map: videoTexture,
      emissiveMap: videoTexture,
      emissive: '#ffffff',
      emissiveIntensity: 0.5,
      roughness: 0.4,
      metalness: 0.0,
    })
    materialRef.current = crtMat
    screenMesh.material = crtMat

    // --- Timers ---
    const timers = []
    function clearTimers() {
      timers.forEach(clearTimeout)
      timers.length = 0
    }

    // --- Helpers ---
    function setScreenTexture(texture, isVideo) {
      crtMat.map = texture
      crtMat.mapFlipY = isVideo ? 1.0 : 0.0
      crtMat.needsUpdate = true
    }

    function turnOff() {
      clearTimers()
      powerTargetRef.current = 0
      useChannelStore.setState({ phase: 'off', noSignal: false, buffering: false })
      // Let the CRT squeeze animation play, then clean up
      timers.push(setTimeout(() => {
        video.pause()
        video.removeAttribute('src')
        video.load()
        setScreenTexture(videoTexture, true)
        crtMat.color.setScalar(0.0)
        crtMat.noSignal = 0
        crtMat.staticAmount = 0
        crtMat.emissiveIntensity = 0
      }, 400))
    }

    function startIntro() {
      clearTimers()
      crtMat.power = 0
      powerTargetRef.current = 1
      crtMat.color.setScalar(1.0)
      crtMat.emissiveIntensity = 0.5
      crtMat.noSignal = 1.0
      crtMat.staticAmount = 0.04
      setScreenTexture(videoTexture, true)
      useChannelStore.getState().setPhase('intro')
      video.loop = false
      video.src = `${CDN}/intro.mov`
      video.load()
      mobilePlay().catch(() => {
        if (mounted) enterChannelsMode()
      })
    }

    function enterChannelsMode() {
      if (!mounted) return
      clearTimers()
      crtMat.color.setScalar(1.0)
      crtMat.emissiveIntensity = 0.5
      useChannelStore.setState({ phase: 'channels', buffering: false })
      setScreenTexture(videoTexture, true)
      video.loop = false
      const src = useChannelStore.getState().channels[useChannelStore.getState().currentChannel]
      crtMat.staticAmount = 0.04
      crtMat.noSignal = 1.0
      if (src) {
        video.src = src
        video.load()
        mobilePlay().then(() => {
          if (!mounted) return
          crtMat.noSignal = 0.0
          useChannelStore.setState({ noSignal: false })
        }).catch(() => {
          if (!mounted) return
          crtMat.noSignal = 1.0
          useChannelStore.setState({ noSignal: true })
        })
      } else {
        useChannelStore.setState({ noSignal: true })
      }
    }

    // --- Video events ---
    function playClip(src, phaseName) {
      useChannelStore.getState().setPhase(phaseName)
      crtMat.color.setScalar(0.35)
      crtMat.emissiveIntensity = 0.15
      crtMat.staticAmount = 0.04
      crtMat.noSignal = 1.0
      video.src = src
      video.load()
      mobilePlay().then(() => {
        if (!mounted) return
        crtMat.noSignal = 0.0
      }).catch(() => { if (mounted) enterChannelsMode() })
    }

    function glitchThen(cb) {
      crtMat.noSignal = 1.0
      crtMat.staticAmount = 0.5
      timers.push(setTimeout(() => { if (mounted) cb() }, 600))
    }

    const onEnded = () => {
      if (!mounted) return
      const phase = useChannelStore.getState().phase
      if (phase === 'intro') {
        useChannelStore.getState().setPhase('glitch')
        glitchThen(() => playClip(`${CDN}/orangeclip1.mp4`, 'orange-1'))
      } else if (phase === 'orange-1') {
        useChannelStore.getState().setPhase('glitch')
        glitchThen(() => playClip(`${CDN}/orangeclip2.mp4`, 'orange-2'))
      } else if (phase === 'orange-2') {
        useChannelStore.getState().setPhase('glitch')
        glitchThen(() => enterChannelsMode())
      } else if (phase === 'channels') {
        useChannelStore.getState().nextChannel()
      }
    }

    const onWaiting = () => {
      if (useChannelStore.getState().phase === 'channels') {
        useChannelStore.setState({ buffering: true })
      }
    }

    const onPlaying = () => {
      if (!mounted) return
      if (useChannelStore.getState().phase === 'intro') {
        crtMat.noSignal = 0.0
      }
      useChannelStore.setState({ buffering: false })
    }

    const onError = () => {
      if (!mounted) return
      if (useChannelStore.getState().phase === 'intro') {
        enterChannelsMode()
      }
    }

    video.addEventListener('ended', onEnded)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('error', onError)

    // --- Start with TV off ---
    turnOff()

    // --- Subscribe to store ---
    const unsub = useChannelStore.subscribe((s, prev) => {
      if (!mounted) return

      // Power toggle
      if (s.tvOn !== prev.tvOn) {
        if (s.tvOn) startIntro()
        else turnOff()
        return
      }

      // Volume / mute sync — desktop only (mobile uses hardware buttons + silent switch)
      if (s.phase !== 'off' && !mobile) {
        if (s.isMuted !== prev.isMuted) video.muted = s.isMuted
        if (s.volume !== prev.volume) video.volume = s.volume
      }

      // Channel change — only in channels mode
      if (s.phase !== 'channels') return

      if (s.currentChannel !== prev.currentChannel) {
        const url = s.channels[s.currentChannel]
        if (!url) {
          crtMat.noSignal = 1.0
          useChannelStore.setState({ noSignal: true })
          video.pause()
          return
        }
        crtMat.noSignal = 1.0
        crtMat.staticAmount = 0.3
        useChannelStore.setState({ noSignal: false })
        video.src = url
        video.load()
        mobilePlay().then(() => {
          if (!mounted) return
          crtMat.noSignal = 0.0
          crtMat.staticAmount = 0.04
        }).catch(() => {
          if (!mounted) return
          crtMat.noSignal = 1.0
          crtMat.staticAmount = 0.04
          useChannelStore.setState({ noSignal: true })
        })
      }
    })

    return () => {
      mounted = false
      unsub()
      clearTimers()
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error', onError)
      video.pause()
      video.removeAttribute('src')
      video.load()
      document.body.removeChild(video)
      videoTexture.dispose()
      crtMat.dispose()
    }
  }, [screenMesh])

  // Starting X of the animation (first keyframe = -8.7621)
  const animStartX = useRef(null)

  useFrame((_, delta) => {
    if (mixerRef.current) mixerRef.current.update(delta)

    // Apply the empty's animated X slide as an offset to setup nodes
    if (emptyRef && animationPlaying) {
      if (animStartX.current === null) animStartX.current = emptyRef.position.x
      const offset = (emptyRef.position.x - animStartX.current) * 2
      if (offset !== lastOffsetRef.current) {
        lastOffsetRef.current = offset
        const { nodes, origX } = animNodes
        for (let i = 0; i < nodes.length; i++) {
          nodes[i].position.x = origX[i] + offset
        }
      }
    } else if (!animationPlaying && animStartX.current !== null) {
      // Restore original positions
      const { nodes, origX } = animNodes
      for (let i = 0; i < nodes.length; i++) {
        nodes[i].position.x = origX[i]
      }
      animStartX.current = null
      lastOffsetRef.current = null
    }

    if (materialRef.current) {
      materialRef.current.time += delta

      // Animate CRT power on/off
      const target = powerTargetRef.current
      const current = materialRef.current.power
      const diff = target - current
      if (Math.abs(diff) > 0.001) {
        const step = delta * 3.5 // ~285ms full travel
        materialRef.current.power = current + Math.sign(diff) * Math.min(Math.abs(diff), step)
      } else if (current !== target) {
        materialRef.current.power = target
      }

      if (tvuiRef.current) {
        materialRef.current.tvUiTexture = tvuiRef.current
      }
    }
  })

  const isTVMesh = (object) => {
    if (!tvNode) return false
    let current = object
    while (current) {
      if (current === tvNode) return true
      current = current.parent
    }
    return false
  }

  const handleClick = (e) => {
    const mobile = window.innerWidth / window.innerHeight < 1

    if (mobile && mobileTapRef) {
      e.stopPropagation()
      const tap = mobileTapRef.current
      if (tap === 0) {
        // Tap 1 → zoom to TV. Audio unlock via native DOM click (App.jsx).
        if (videoRef.current) {
          videoRef.current.muted = false
          videoRef.current.volume = 1.0
        }
        useChannelStore.setState({ isMuted: false, volume: 1.0 })
        onGoTo('tv')
        mobileTapRef.current = 1
      } else if (tap === 1) {
        // Tap 2 → turn TV on (audio already unlocked from tap 1)
        if (videoRef.current) videoRef.current.muted = false
        useChannelStore.getState().togglePower()
        mobileTapRef.current = 2
      } else if (tap === 2) {
        // Tap 3 → turn TV off
        const s = useChannelStore.getState()
        if (s.tvOn) s.togglePower()
        mobileTapRef.current = 3
      } else {
        // Tap 4 → zoom back to default, reset cycle
        onGoTo('default')
        mobileTapRef.current = 0
      }
      return
    }

    // Desktop: only respond to TV mesh clicks
    if (!isTVMesh(e.object)) return
    e.stopPropagation()
    onGoTo('tv')
  }

  const handlePointerOver = (e) => {
    if (isTVMesh(e.object)) document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = (e) => {
    if (isTVMesh(e.object)) document.body.style.cursor = 'default'
  }

  return (
    <>
      <primitive
        object={scene}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        {...props}
      />
      <TVUI ref={tvuiRef} />
    </>
  )
}
