# Jellybash — implementation plan

A browser party-sports collection with chunky, wobbly jellybean characters. Original names, art and levels; game *genres* (bowling, tennis, obstacle races…) are the inspiration.

## Stack
- Vite + TypeScript (vanilla, no framework)
- three.js for rendering (toon / soft shading, procedural meshes — no external assets)
- Rapier (`@dimforge/rapier3d-compat`) for physics
- WebAudio for procedural sound effects

## Architecture
```
src/
  main.ts              boot: Rapier init, engine, game registry, window.__game debug hook
  style.css            HUD styles
  core/
    engine.ts          renderer, resize, fixed 60 Hz loop + interpolated render, disposeObject()
    minigame.ts        Minigame interface + registry
    physicsSync.ts     rigid body -> mesh sync with interpolation
    input.ts           pointer drag/flick + keyboard (unused presses cleared every frame)
    hud.ts             DOM overlay helpers, banners
    audio.ts           procedural WebAudio SFX
    toon.ts            shared toon gradient + material helper
  characters/
    bean.ts            original jellybean: pear body, painted face, leaf sprout, mitten arms, spring wobble
  games/bowling/
    bowling.ts         game flow, input, cameras, HUD
    world.ts           lane/gutters/pit colliders + visuals, pin geometry & bodies
    scoring.ts         pure ten-pin scoring (+ scoring.test.ts, `npm test`)
    confetti.ts        instanced confetti
  hub/menu.ts          (phase 2) game picker
```
`Minigame = { id, title, init(ctx), update(dt), fixedUpdate(dt), dispose() }`. `dispose()` must free every
physics body, mesh, material and listener so games can be swapped without leaks.

## Phases
1. **Foundation + Bowling** — DONE 2026-11-15
   - Engine loop, input, HUD, bean character with wind-up / throw / cheer / flop animations
   - Lane, gutters, 10 pins (low centre of mass, start asleep), ball with CCD
   - Drag-and-flick to throw (aim + power + spin), keyboard fallback
   - Pin-down detection after settle (tilt / drop + timeout), sweep & reset
   - Ten-frame scoring as a pure, tested function
   - Debug hook `window.__game` for automated checks
2. **Hub + polish** (next) — game picker, bean customiser (colours, hats, costumes), transitions, ragdoll flops, music
3. **Tennis-style rally game** — 1v1 vs AI, swing timing via flick
4. **Obstacle race** — physics-based bean controller, spinning bars, falling tiles, AI racers
5. **More minigames** — golf, boxing, survival “last bean standing” arena, team games
6. **Multiplayer** — local hot-seat first, then online via WebRTC/WebSocket rooms
