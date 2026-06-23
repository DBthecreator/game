# HOOKED 🪝

An original, endless grapple-swing arcade game. Fling yourself across a
procedurally-generated neon skyline on grappling tethers — **hold to grab the
nearest anchor and swing, release to fly.** Chain swings to keep your combo
alive, scoop up cents mid-arc, and travel as far as you can before you drop
into a gap.

Built to be instantly pick-up-and-play, one-thumb, and hard to put down — in
the spirit of the all-time mobile hits, but with its own mechanic (not a clone
of any of them).

## Play

It's a zero-dependency web game (HTML + CSS + Canvas). Just serve the folder:

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000 on your phone or desktop
```

Or open `index.html` directly (a server is recommended so the PWA / offline
support and service worker work).

### Controls
- **Touch:** hold anywhere to grapple & swing, release to let go.
- **Desktop:** hold **Space**.

## The hook (pun intended)
- **Pendulum physics** — grab an anchor and you swing on a real rope; release at
  the bottom of the arc to convert that momentum into a long fling.
- **Pumping** — holding through the low point of a swing adds energy, so good
  timing builds speed. Skill ceiling, easy floor.
- **Combo chain** — every swing without touching the ground raises your chain
  multiplier, which boosts the value of the cents you grab.
- **Endless & escalating** — gaps widen, drones appear, dusk turns to deep
  night the further you go.

## Features
- Procedurally generated, infinite world with parallax skyline + starfield.
- Juice: trails, particle bursts, screen shake, hit flash, floating score text,
  haptics (`navigator.vibrate`), and a tiny WebAudio synth for SFX.
- Local high scores (distance + cents banked) saved to `localStorage`.
- Installable **PWA** with offline support (service worker).
- Share-score button (Web Share API with clipboard fallback).

## Files
| File | Purpose |
|------|---------|
| `index.html` | App shell, HUD & overlays |
| `style.css` | All styling / UI |
| `game.js` | Engine, physics, world gen, rendering, game loop |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Service worker (offline cache) |
| `icons/icon.svg` | App icon |

## Roadmap ideas
- Daily seed / leaderboard, unlockable orb skins (spend your cents!), moving
  anchors, wind gusts, and a "near miss" bonus for grabbing late.

---
Made as a from-scratch original. No frameworks, no copy-cats.
