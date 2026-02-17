import { create } from 'zustand'

const useChannelStore = create((set, get) => ({
  // TV power + phase
  phase: 'off', // 'off' | 'intro' | 'glitch' | 'drb-logos' | 'drb-psa' | 'channels'
  setPhase: (phase) => set({ phase }),
  tvOn: false,
  togglePower: () => set((s) => ({ tvOn: !s.tvOn })),

  // Channel state
  currentChannel: 1,
  channels: {
    1: '/videos/ch1.mp4',
    2: '/videos/ch2.mp4',
    3: '/videos/ch3.mp4',
  },
  noSignal: false,
  buffering: false,

  setChannel: (ch) => {
    set({ currentChannel: ch, noSignal: false, inProgressChannelNumber: '' })
  },

  nextChannel: () => {
    const { currentChannel, channels } = get()
    const keys = Object.keys(channels).map(Number).sort((a, b) => a - b)
    const idx = keys.indexOf(currentChannel)
    const next = idx >= keys.length - 1 ? keys[0] : keys[idx + 1]
    get().setChannel(next)
  },

  prevChannel: () => {
    const { currentChannel, channels } = get()
    const keys = Object.keys(channels).map(Number).sort((a, b) => a - b)
    const idx = keys.indexOf(currentChannel)
    const prev = idx <= 0 ? keys[keys.length - 1] : keys[idx - 1]
    get().setChannel(prev)
  },

  // Channel number entry (progressive digit input)
  inProgressChannelNumber: '',
  channelEntryTimeout: null,

  enterChannelNumber: (digit) => {
    const state = get()
    const newNum = state.inProgressChannelNumber + digit.toString()
    if (newNum.length > 3) return

    if (state.channelEntryTimeout) clearTimeout(state.channelEntryTimeout)

    if (newNum.length === 3) {
      const ch = parseInt(newNum, 10)
      set({ inProgressChannelNumber: newNum, channelEntryTimeout: null })
      get().setChannel(ch)
      return
    }

    const timer = setTimeout(() => {
      const current = get().inProgressChannelNumber
      if (!current) return
      const ch = parseInt(current, 10)
      set({ inProgressChannelNumber: '', channelEntryTimeout: null })
      get().setChannel(ch)
    }, 2000)

    set({ inProgressChannelNumber: newNum, channelEntryTimeout: timer })
  },

  // Volume state
  volume: 0.5,
  volumeUpCount: 0,
  volumeDownCount: 0,

  volumeUp: () => set((s) => ({
    volume: Math.min(1, +(s.volume + 0.05).toFixed(2)),
    isMuted: false,
    volumeUpCount: s.volumeUpCount + 1,
  })),

  volumeDown: () => set((s) => ({
    volume: Math.max(0, +(s.volume - 0.05).toFixed(2)),
    isMuted: false,
    volumeDownCount: s.volumeDownCount + 1,
  })),

  // Mute state
  isMuted: true,
  mutedCount: 0,

  toggleMute: () => set((s) => ({
    isMuted: !s.isMuted,
    mutedCount: s.mutedCount + 1,
  })),

  // UI display state (prevents buffering/volume text overlap)
  isVolumeBeingDisplayed: false,
  setIsVolumeBeingDisplayed: (val) => set({ isVolumeBeingDisplayed: val }),

  // Animation
  animationPlaying: false,
  toggleAnimation: () => set((s) => ({ animationPlaying: !s.animationPlaying })),

  // Camera slots (persisted to localStorage)
  cameraSlots: JSON.parse(localStorage.getItem('lucki-tv-camera-slots') || '[]'),
  defaultSlotIndex: parseInt(localStorage.getItem('lucki-tv-default-slot') || '-1', 10),

  saveSlot: (name, position, target) => {
    const slots = [...get().cameraSlots, { name, position, target }]
    localStorage.setItem('lucki-tv-camera-slots', JSON.stringify(slots))
    set({ cameraSlots: slots })
  },

  deleteSlot: (index) => {
    const slots = get().cameraSlots.filter((_, i) => i !== index)
    let def = get().defaultSlotIndex
    if (def === index) def = -1
    else if (def > index) def--
    localStorage.setItem('lucki-tv-camera-slots', JSON.stringify(slots))
    localStorage.setItem('lucki-tv-default-slot', String(def))
    set({ cameraSlots: slots, defaultSlotIndex: def })
  },

  renameSlot: (index, name) => {
    const slots = get().cameraSlots.map((s, i) => i === index ? { ...s, name } : s)
    localStorage.setItem('lucki-tv-camera-slots', JSON.stringify(slots))
    set({ cameraSlots: slots })
  },

  setDefaultSlot: (index) => {
    localStorage.setItem('lucki-tv-default-slot', String(index))
    set({ defaultSlotIndex: index })
  },

  updateSlot: (index, position, target) => {
    const slots = get().cameraSlots.map((s, i) => i === index ? { ...s, position, target } : s)
    localStorage.setItem('lucki-tv-camera-slots', JSON.stringify(slots))
    set({ cameraSlots: slots })
  },

  // Environment master toggle — hides all set dressing, keeps TV setup
  envVisible: false,
  toggleEnv: () => set((s) => {
    const next = !s.envVisible
    const allLayers = {}
    for (const key of Object.keys(s.layers)) allLayers[key] = next
    return { envVisible: next, layers: allLayers }
  }),

  // Layer visibility toggles
  layers: {
    lightBars: false,
    pipes: false,
    cylinders: false,
    cubes: false,
    planes: false,
    guitarStrap: false,
    curves: false,
  },
  toggleLayer: (key) => set((s) => ({
    layers: { ...s.layers, [key]: !s.layers[key] },
  })),
}))

export default useChannelStore
