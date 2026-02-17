# Lucki TV Viewer

React Three Fiber interactive 3D viewer for the Lucki TV scene.

## Setup

```bash
npm install
npm run dev
```

## Controls

| Key | Action |
|-----|--------|
| **WASD** | Move camera forward/back/left/right |
| **Q / E** | Move camera up/down |
| **Shift** | Hold for faster movement |
| **Mouse** | Orbit (left drag), pan (right drag), zoom (scroll) |
| **Space** | Jump to default camera view |
| **Ctrl+1-9** | Jump to saved camera slot |
| **H** | Toggle control panel |
| **O** | TV power on/off |
| **Arrow Up/Down** | Change channel |
| **0-9** | Enter channel number |
| **+/-** | Volume up/down |
| **M** | Mute toggle |
| **L** | Animation toggle (play once, stays at end) |
| **Click TV** | Fly camera to TV close-up |

## Features

### Camera System
- WASD + QE free movement with shift speed boost
- Save/rename/delete/overwrite multiple camera positions
- Set any saved position as default (star icon)
- Export/import camera positions as JSON
- Ctrl+1-9 quick slot access
- Smooth cinematic transitions on click/slot select

### TV System
- CRT shader with power on/off animation, static, scanlines
- Intro sequence → orange clips → channel mode
- 3-digit channel entry with timeout
- Volume control with mute
- Video playback with buffering/no-signal states

### Scene Layers
Toggle visibility of scene elements via the H panel:
- Light Bars, Pipes, Cylinders, Cubes, Planes, Guitar Strap, Curves

### Animation
- Single GLB animation clip (`MODEL__EMPTY` X-axis slide)
- Plays once on toggle (L key), model stays at final position
- Toggle again to reset to original position

### Lighting (Theatre.js)
- Full Theatre.js Studio editor for scene lighting
- Editable Key Light, Fill Light, Point Light, Spot Light
- Drag lights in viewport, keyframe properties on timeline
- Environment map presets (studio, city, sunset, etc.)

### FPS Counter
- Stats display in bottom-left corner (FPS, MS, memory)

## Architecture

| File | Purpose |
|------|---------|
| `App.jsx` | Canvas, camera, controls, keyboard shortcuts, Theatre.js setup |
| `Model.jsx` | GLB loading, animation mixer, layer visibility, TV click handling |
| `TvScreenMaterial.js` | Custom CRT shader (scanlines, static, power on/off) |
| `TVUI.jsx` | TV overlay UI (channel display, volume bar, buffering) |
| `store.js` | Zustand state (TV, channels, volume, animation, layers, camera slots) |

## GLB Animation Issue & Solution

### The Problem

The Blender scene export (`scene_export.glb`) contains 1 animation clip: `MODEL  EMPTYAction` (2.13s). It targets an empty/null object called `MODEL  EMPTY` which was used as a controller in Blender.

Three issues prevented it from working in the web viewer:

1. **Name sanitization** — Three.js GLTFLoader converts spaces to underscores. The node becomes `MODEL__EMPTY` in the scene graph, but the code was searching for `MODEL  EMPTY` (with spaces).

2. **Lost parent relationships** — In Blender, the TV/VCR/trolley were children of the empty. On GLB export, all objects became top-level siblings. The animation played on the empty but nothing was parented to it, so nothing moved.

3. **Baked Blender coordinates** — The animation keyframes carry the Blender scene transform:
   - Position: Y=4.34, Z=-36.14 (Blender world position, not web scene origin)
   - Scale: 2.75x / 4.27x / 2.75x (Blender scene scale)
   - Only the X-axis actually animates: slides from -8.76 to +1.77 over 2.13s

   Reparenting the TV under the empty applied these huge position/scale values, sending the model 36 units behind the camera and scaling it 3-4x.

### The Solution

Instead of reparenting (which inherits the empty's broken world transform), the animation is read indirectly:

1. `AnimationMixer` runs on the scene and updates `MODEL__EMPTY`'s position each frame
2. In `useFrame`, only the **X-axis delta** is read from the empty (`current X - start X`)
3. That delta offset is added to the setup nodes' original X positions (TV, VCR, trolley, strap)
4. Environment nodes (light bars, pipes, cylinders, cubes, planes) are excluded — they don't move
5. Animation plays once (`LoopOnce` + `clampWhenFinished`) and holds final position

### Key Takeaway

If re-exporting from Blender, the cleanest fix would be:
- Move `MODEL  EMPTY` to origin (0,0,0) with scale (1,1,1) before exporting
- Keep TV/VCR/trolley parented to it
- Then reparenting in code would work directly without coordinate translation
