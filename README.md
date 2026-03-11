# Lucki TV Viewer

Interactive 3D TV viewer built with React Three Fiber. Features a CRT TV model with live video playback, channel switching, and a custom loading screen.

## Stack

- React 19 + Vite
- Three.js / React Three Fiber / Drei
- Zustand (state management)
- Theatre.js (scene light editing in dev)

## Dev

```bash
npm install
npm run dev       # http://localhost:5173
npm run build
```

## Controls

| Key | Action |
|-----|--------|
| O | TV on/off |
| ↑ ↓ | Channel up/down |
| 0–9 | Direct channel entry |
| +/- | Volume |
| M | Mute |
| L | Toggle animation |
| Space | Reset camera to default view |
| WASD | Move camera |
| QE | Camera up/down |
| Shift | Fast camera movement |
| H | Show/hide debug panel |
| Ctrl+1–9 | Jump to saved camera slot |

Mobile: tap to zoom in / zoom back out / turn TV off (3-tap cycle).

## Assets

- `public/assets/tv-optimized.glb` — Draco-compressed TV model (Git LFS)
- `public/loading/` — Logo PNG sequence for loading screen
- `public/videos/` — Channel video files (ch1.mp4, ch2.mp4, ch3.mp4)
- `public/draco/` — Draco decoder

## GLB Pipeline

Source: `lucki-tv-working.glb` → compress via `compress-glb.cjs`:

```bash
node compress-glb.cjs
```

Strips environment meshes, runs dedup/weld/prune, compresses textures to WebP, applies Draco encoding. Output: `public/assets/tv-optimized.glb`.

## Deployment

Deploys to GitHub Pages via push to `main`.
