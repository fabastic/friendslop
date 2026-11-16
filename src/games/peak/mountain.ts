/**
 * Jelly Peak's tower: a candy pillar with a seeded, randomly generated spiral of *stuff* piled
 * around it — the same toys that decorate the bowling alley (candy shapes, stars, donuts, arches,
 * bowling balls and pins, benches, clouds, balloons). Every object is a real platform: its collider
 * is a triangle mesh built from the exact rendered geometry, so what you see is what you stand on.
 * The pillar itself is climbable (holds mark the good routes) for the gaps the pile leaves.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toon, jelly } from '../../core/toon.ts';
import { fitModel } from '../../core/assets.ts';
import { mulberry, makeCandyBench, pinGeometry, starGeometry, SCENE_PALETTE } from '../bowling/world.ts';

export interface Checkpoint {
  pos: THREE.Vector3;
  index: number;
  marker: THREE.Object3D;
}
export interface Berry {
  pos: THREE.Vector3;
  mesh: THREE.Object3D;
  taken: boolean;
  respawn: number;
}
/** Bouncy balloon: land on top and get flung up. */
export interface Pad {
  pos: THREE.Vector3;
  r: number;
  dome: THREE.Object3D;
  squish: number;
}
/** (unused on this layout, kept for the game's API) */
export interface Mover {
  body: RAPIER.RigidBody;
  mesh: THREE.Object3D;
  half: THREE.Vector3;
  pos: THREE.Vector3;
  delta: THREE.Vector3;
  theta: number;
  r: number;
  y: number;
  swing: number;
  period: number;
  phase: number;
}
/** Floating candy hoop: jump through it for a stamina refill and a little lift. */
export interface Ring {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  mesh: THREE.Mesh;
  cooldown: number;
}
/** Climbing hold on the tower: grabbing one while climbing gives back some grip. */
export interface Hold {
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  cooldown: number;
}

export interface Mountain {
  clearR: number;
  height: number;
  summit: THREE.Vector3;
  start: THREE.Vector3;
  checkpoints: Checkpoint[];
  berries: Berry[];
  pads: Pad[];
  movers: Mover[];
  rings: Ring[];
  holds: Hold[];
  /** standable tops along the spiral, bottom to top (for playtest bots) */
  route: THREE.Vector3[];
  stepMovers(time: number): void;
  update(dt: number, t: number): void;
}

const TOWER_R = 2.6;
const HOLD_COLS = ['#ff4fa3', '#ffd23f', '#22c4e8', '#3ccf7a', '#7b4dff', '#ff8a3d'];

type Kind = 'drum' | 'block' | 'donut' | 'ball' | 'pin' | 'star' | 'arch' | 'capsule' | 'bench' | 'cloud' | 'balloon' | 'knot';
const KINDS: Kind[] = ['drum', 'block', 'donut', 'ball', 'pin', 'star', 'arch', 'capsule', 'bench', 'cloud', 'balloon', 'knot', 'drum', 'block', 'star', 'cloud'];

export function buildMountain(R: typeof RAPIER, world: RAPIER.World, scene: THREE.Scene, seed = 20261116): Mountain {
  const rnd = mulberry(seed);
  const range = (a: number, b: number) => a + rnd() * (b - a);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
  const statics = world.createRigidBody(R.RigidBodyDesc.fixed());

  /** Exact collider: every mesh's triangles, baked into world space. */
  const collide = (root: THREE.Object3D) => {
    root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.userData.noCollide) return;
      const g = m.geometry;
      const pos = g.attributes.position;
      const verts = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        verts[i * 3] = v.x;
        verts[i * 3 + 1] = v.y;
        verts[i * 3 + 2] = v.z;
      }
      const idx = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: pos.count }, (_, i) => i);
      world.createCollider(R.ColliderDesc.trimesh(verts, idx).setFriction(0.9), statics);
    });
  };
  const shade = (m: THREE.Object3D) => m.traverse((o) => {
    const mm = o as THREE.Mesh;
    if (mm.isMesh) mm.castShadow = mm.receiveShadow = true;
  });

  // ---- meadow
  const meadow = new THREE.Mesh(new THREE.CylinderGeometry(42, 42, 1, 48), toon('#9be59a'));
  meadow.position.y = -0.5;
  meadow.receiveShadow = true;
  scene.add(meadow);
  world.createCollider(R.ColliderDesc.cylinder(0.5, 42).setTranslation(0, -0.5, 0).setFriction(0.9), statics);

  // ---- assets from the bowling alley
  const pinFit = fitModel('keatura-bowling.glb', (n) => n.startsWith('Cube001_bowling') || n.startsWith('Cube.001_bowling'), 1.3, { upright: true });
  const ballFit = fitModel('keatura-bowling.glb', (n) => n.startsWith('Cube_bowling'), 1.2, { by: 'max' });

  /** One random pile object, built around its own origin. Returns the object and whether it's a bounce pad. */
  const makeThing = (kind: Kind): THREE.Object3D => {
    const col = pick(SCENE_PALETTE);
    const mat = toon(col, {}, 0.5);
    switch (kind) {
      case 'drum': {
        const r = range(0.65, 0.95);
        return new THREE.Mesh(new THREE.CylinderGeometry(r, r * range(0.85, 1), range(0.5, 1.0), 24), mat);
      }
      case 'block': {
        const m = new THREE.Mesh(new RoundedBoxGeometry(range(1.2, 1.8), range(0.5, 0.9), range(1.1, 1.6), 3, 0.12), mat);
        m.rotation.y = range(-0.5, 0.5);
        return m;
      }
      case 'donut': {
        const m = new THREE.Mesh(new THREE.TorusGeometry(range(0.7, 0.95), range(0.3, 0.38), 12, 28), mat);
        m.rotation.x = Math.PI / 2;
        return m;
      }
      case 'ball': {
        const m = ballFit ? new THREE.Mesh(ballFit.geometry.clone(), ballFit.map ? toon('#ffffff', { map: ballFit.map }, 0.4) : mat) : new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 16), mat);
        m.scale.setScalar(range(0.9, 1.25));
        m.rotation.set(rnd() * 3, rnd() * 3, 0);
        return m;
      }
      case 'pin': {
        // giant bowling pin lying on its side
        const geo = pinFit ? pinFit.geometry.clone() : pinGeometry();
        if (!pinFit) geo.scale(3.4, 3.4, 3.4);
        const m = new THREE.Mesh(geo, pinFit?.map ? toon('#ffffff', { map: pinFit.map }, 0.5) : toon('#ffffff', { vertexColors: !pinFit }));
        m.rotation.z = Math.PI / 2;
        m.rotation.y = range(0, Math.PI);
        return m;
      }
      case 'star': {
        const m = new THREE.Mesh(starGeometry(range(0.9, 1.15), 0.35), mat);
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = rnd() * Math.PI;
        return m;
      }
      case 'arch': {
        const m = new THREE.Mesh(new THREE.TorusGeometry(range(0.7, 0.9), 0.24, 10, 24, Math.PI), mat);
        m.rotation.y = range(0, Math.PI);
        return m;
      }
      case 'capsule': {
        const m = new THREE.Mesh(new THREE.CapsuleGeometry(range(0.38, 0.5), range(0.9, 1.4), 6, 16), mat);
        m.rotation.z = Math.PI / 2;
        m.rotation.y = range(0, Math.PI);
        return m;
      }
      case 'bench': {
        const b = makeCandyBench(pick(SCENE_PALETTE), pick(SCENE_PALETTE)).group;
        b.scale.setScalar(1.35);
        b.rotation.y = range(0, Math.PI * 2);
        const g = new THREE.Group();
        g.add(b);
        return g;
      }
      case 'cloud': {
        const g = new THREE.Group();
        const cm = toon('#ffffff', {}, 0.2);
        const n = 4 + Math.floor(rnd() * 2);
        for (let k = 0; k < n; k++) {
          const puff = new THREE.Mesh(new THREE.SphereGeometry(range(0.38, 0.5), 14, 10), cm);
          puff.position.set((k - (n - 1) / 2) * 0.42, 0, (k % 2 ? 0.18 : -0.18));
          puff.scale.y = 0.6;
          g.add(puff);
        }
        g.rotation.y = range(0, Math.PI);
        return g;
      }
      case 'balloon': {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), jelly(col, { opacity: 0.9, glow: 0.4 }));
        b.scale.y = 1.15;
        const knot = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.12, 6), mat);
        knot.position.y = -0.66;
        knot.rotation.x = Math.PI;
        knot.userData.noCollide = true;
        g.add(b, knot);
        return g;
      }
      case 'knot':
      default: {
        const m = new THREE.Mesh(new THREE.TorusKnotGeometry(0.55, 0.2, 64, 10), mat);
        m.rotation.set(rnd() * 3, rnd() * 3, 0);
        return m;
      }
    }
  };

  // ---- the tower
  const STEPS = 54;
  const items: { top: number; theta: number; r: number }[] = [];
  const route: THREE.Vector3[] = [];
  const checkpoints: Checkpoint[] = [];
  const berries: Berry[] = [];
  const pads: Pad[] = [];
  const rings: Ring[] = [];
  const holds: Hold[] = [];
  const bobbers: { o: THREE.Object3D; base: number; ph: number }[] = [];
  const spinners: THREE.Object3D[] = [];
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();

  const addCheckpoint = (pos: THREE.Vector3) => {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.5, 8), toon('#fff3e6'));
    stem.position.y = 0.25;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), jelly('#7fe0ff', { opacity: 0.85, glow: 0.8 }));
    cap.position.y = 0.48;
    g.add(stem, cap);
    g.position.copy(pos);
    scene.add(g);
    bobbers.push({ o: cap, base: cap.position.y, ph: checkpoints.length });
    checkpoints.push({ pos: pos.clone(), index: checkpoints.length, marker: g });
  };
  const addHold = (theta: number, y: number) => {
    const p = new THREE.Vector3(Math.sin(theta) * (TOWER_R + 0.05), y, Math.cos(theta) * (TOWER_R + 0.05));
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), toon(pick(HOLD_COLS), {}, 0.3));
    m.position.copy(p);
    m.scale.set(1.3, 0.8, 1);
    m.castShadow = true;
    scene.add(m);
    holds.push({ pos: p, mesh: m, cooldown: 0 });
  };

  const start = new THREE.Vector3(0, 0, TOWER_R + 3.2);
  addCheckpoint(start);

  let theta = 0;
  let top = 0.6;
  for (let i = 0; i < STEPS; i++) {
    const rest = i > 0 && i % 9 === 0;
    const gap = !rest && i > 3 && i % 7 === 4; // no object here: climb the tower past it
    theta += range(0.55, 0.78);
    top += range(0.75, 1.25);
    if (gap) {
      // holds up the tower face across the gap
      for (let k = 0; k < 4; k++) addHold(theta + range(-0.25, 0.25), top - 1.4 + k * 0.7);
      continue;
    }
    const kind: Kind = rest ? 'block' : i < 3 ? pick(['drum', 'block'] as const) : pick(KINDS);
    const thing = makeThing(kind);
    if (rest) thing.scale.set(1.5, 1, 1.5);
    // measure its rotated bounds, then park it so its top sits at `top`, hugging the tower
    thing.updateMatrixWorld(true);
    box.setFromObject(thing);
    box.getSize(size);
    box.getCenter(centre);
    const radial = TOWER_R + Math.max(size.x, size.z) * 0.42;
    thing.position.set(Math.sin(theta) * radial - centre.x, top - box.max.y, Math.cos(theta) * radial - centre.z);
    shade(thing);
    scene.add(thing);
    collide(thing);
    const topPos = new THREE.Vector3(Math.sin(theta) * radial, top, Math.cos(theta) * radial);
    items.push({ top, theta, r: radial });
    route.push(topPos.clone());

    if (kind === 'balloon') pads.push({ pos: topPos.clone(), r: 0.55, dome: thing, squish: 0 });
    if (rest) addCheckpoint(topPos.clone());
    else if (kind !== 'balloon' && kind !== 'knot' && rnd() < 0.18) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), jelly('#ff4f7a', { opacity: 0.9, glow: 0.6 }));
      const bp = topPos.clone().add(new THREE.Vector3(0, 0.45, 0));
      b.position.copy(bp);
      scene.add(b);
      berries.push({ pos: bp, mesh: b, taken: false, respawn: 0 });
      spinners.push(b);
    }
    if (i % 6 === 3) {
      // hoop hanging just outside the spiral, on the way to the next object
      const a = theta + 0.35;
      const hp = new THREE.Vector3(Math.sin(a) * (radial + 0.6), top + 1.1, Math.cos(a) * (radial + 0.6));
      const tangent = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.1, 10, 24), toon(pick(HOLD_COLS)));
      hoop.position.copy(hp);
      hoop.lookAt(hp.clone().add(tangent));
      hoop.castShadow = true;
      scene.add(hoop);
      rings.push({ pos: hp, normal: tangent, mesh: hoop, cooldown: 0 });
    }
  }
  const height = top + 1.0;

  // tower: candy-striped pillar with an exact cylinder collider
  for (let y = 0, k = 0; y < height; y += 3, k++) {
    const h = Math.min(3, height - y);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_R, TOWER_R, h, 32), toon(k % 2 ? '#fff3e6' : '#ff9ec9'));
    band.position.y = y + h / 2;
    band.castShadow = band.receiveShadow = true;
    scene.add(band);
  }
  world.createCollider(R.ColliderDesc.cylinder(height / 2, TOWER_R).setTranslation(0, height / 2, 0).setFriction(0.9), statics);

  // summit cap + flag
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(TOWER_R + 0.5, TOWER_R + 0.2, 0.5, 32), toon('#ffd23f'));
  cap.position.y = height + 0.25;
  cap.castShadow = cap.receiveShadow = true;
  scene.add(cap);
  collide(cap);
  const summit = new THREE.Vector3(0, height + 0.5, 0);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8), toon('#ffffff'));
  pole.position.set(0, summit.y + 1.2, 0);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7, 8, 1), toon('#ff4fa3', { side: THREE.DoubleSide }));
  flag.position.set(0.55, summit.y + 2, 0);
  scene.add(pole, flag);

  // ---- fixed play bounds: candy fence on the meadow + invisible walls all the way up
  const BOUND = 30;
  const SEGS = 32;
  const wallH = summit.y + 30;
  const postMat = toon('#ffffff', {}, 0.3);
  const railMat = toon('#ff6fae', {}, 0.3);
  for (let i = 0; i < SEGS; i++) {
    const a = (i / SEGS) * Math.PI * 2;
    const half = BOUND * Math.sin(Math.PI / SEGS) + 0.05;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0));
    world.createCollider(
      R.ColliderDesc.cuboid(half, wallH / 2, 0.3).setTranslation(Math.sin(a) * (BOUND + 0.3), wallH / 2, Math.cos(a) * (BOUND + 0.3)).setRotation(q),
      statics,
    );
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.1, 8), postMat);
    post.position.set(Math.sin(a) * BOUND, 0.55, Math.cos(a) * BOUND);
    post.castShadow = true;
    scene.add(post);
  }
  const rail = new THREE.Mesh(new THREE.TorusGeometry(BOUND, 0.07, 6, 128), railMat);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 0.85;
  scene.add(rail);

  // ---- background: a wide candy-land beyond the fence (visual only)
  const far = new THREE.Mesh(new THREE.CircleGeometry(170, 64), toon('#b6efa9', {}, 0.2));
  far.rotation.x = -Math.PI / 2;
  far.position.y = -0.02;
  far.receiveShadow = true;
  far.userData.noInk = true;
  scene.add(far);
  const bgShape = (r: number): THREE.Mesh => {
    const mat = toon(pick(SCENE_PALETTE), {}, 0.45);
    const k = Math.floor(rnd() * 8);
    const geo = k === 0 ? new THREE.SphereGeometry(r, 20, 14)
      : k === 1 ? new THREE.TorusGeometry(r * 0.75, r * 0.28, 10, 24)
      : k === 2 ? new THREE.CylinderGeometry(r * 0.7, r * 0.8, r * 2.4, 20)
      : k === 3 ? new RoundedBoxGeometry(r * 1.5, r * 1.5, r * 1.5, 2, r * 0.25)
      : k === 4 ? new THREE.ConeGeometry(r * 0.8, r * 2.2, 18)
      : k === 5 ? starGeometry(r, r * 0.45)
      : k === 6 ? new THREE.TorusGeometry(r, r * 0.22, 10, 24, Math.PI)
      : new THREE.TorusKnotGeometry(r * 0.55, r * 0.17, 64, 10);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    return m;
  };
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const d = range(38, 95);
    const r = range(1.5, 3.5) * (d / 45);
    const m = bgShape(r);
    const floatUp = rnd() < 0.4;
    m.position.set(Math.sin(a) * d, floatUp ? range(6, summit.y + 10) : r * 0.9, Math.cos(a) * d);
    m.rotation.set(floatUp ? rnd() * 3 : 0, rnd() * Math.PI * 2, floatUp ? rnd() * 3 : 0);
    scene.add(m);
    if (floatUp) {
      bobbers.push({ o: m, base: m.position.y, ph: rnd() * 6 });
      spinners.push(m);
    }
  }
  // clouds at every height so the climb always has sky dressing around it
  const cloudMat = toon('#ffffff', {}, 0.15);
  for (let i = 0; i < 46; i++) {
    const c = new THREE.Group();
    const n = 4 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(range(0.9, 1.8), 14, 10), cloudMat);
      p.position.set((k - n / 2) * 1.3, rnd() * 0.5, (rnd() - 0.5) * 1.4);
      p.scale.y = 0.65;
      p.userData.noInk = true;
      c.add(p);
    }
    const a = rnd() * Math.PI * 2;
    const d = range(16, 70); // never inside the climb (tower + pile is within ~6 m)
    c.position.set(Math.sin(a) * d, range(3, summit.y + 18), Math.cos(a) * d);
    c.scale.setScalar(range(0.7, 1.6));
    c.lookAt(0, c.position.y, 0);
    scene.add(c);
    bobbers.push({ o: c, base: c.position.y, ph: rnd() * 6 });
  }

  const clearR = TOWER_R + 5;

  return {
    clearR,
    height: summit.y,
    summit,
    start,
    checkpoints,
    berries,
    pads,
    movers: [],
    rings,
    holds,
    route,
    stepMovers() {
      /* nothing moves on this layout */
    },
    update(dt, t) {
      for (const b of bobbers) b.o.position.y = b.base + Math.sin(t * 0.8 + b.ph) * 0.15;
      for (const s of spinners) s.rotation.y += dt * 0.8;
      const pos = flag.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + 0.55;
        pos.setZ(i, Math.sin(t * 6 - x * 4) * 0.08 * x);
      }
      pos.needsUpdate = true;
      for (const b of berries) {
        if (b.taken) {
          b.respawn -= dt;
          if (b.respawn <= 0) b.taken = false;
        }
        b.mesh.visible = !b.taken;
      }
      for (const p of pads) {
        // balloon squash (visual only: the collider stays put)
        p.squish = Math.max(0, p.squish - dt * 2.5);
        const s = Math.sin(p.squish * 14) * p.squish;
        p.dome.scale.set(1 + s * 0.3, 1 - s * 0.4, 1 + s * 0.3);
      }
      for (const r of rings) {
        r.cooldown = Math.max(0, r.cooldown - dt);
        r.mesh.rotateZ(dt * 0.6);
        r.mesh.scale.setScalar(1 + (r.cooldown > 0 ? Math.sin(r.cooldown * 20) * 0.08 : 0));
      }
      for (const h of holds) {
        h.cooldown = Math.max(0, h.cooldown - dt);
        const pop = h.cooldown > 1.6 ? Math.sin((h.cooldown - 1.6) * 30) * 0.3 : 0;
        h.mesh.scale.set(1.3 + pop, 0.8 + pop, 1 + pop);
      }
    },
  };
}
