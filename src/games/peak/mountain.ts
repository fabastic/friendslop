/**
 * Jelly Peak's crag: a seeded climbing route through a field of candy-rock spires. Each spire is a
 * stack of chunky, offset rock blocks (real vertical faces to climb) dotted with colourful holds;
 * the route winds upward from spire top to spire top — jump the gap, grab the wall, climb hold to
 * hold, rest on the ledge. Every run (seed) is a different route; everyone in a party shares it.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { toon, jelly } from '../../core/toon.ts';
import { mulberry } from '../bowling/world.ts';

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

/** Jelly trampoline: land on it and get flung up. */
export interface Pad {
  pos: THREE.Vector3;
  r: number;
  dome: THREE.Mesh;
  squish: number;
}

/** Cloud raft that swings back and forth; it carries whoever stands on it. */
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

/** Climbing hold: grabbing one while climbing gives back a bit of grip (stamina). */
export interface Hold {
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  cooldown: number;
}

export interface Mountain {
  /** radius around the origin that the route occupies (scenery keeps out) */
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
  stepMovers(time: number): void;
  update(dt: number, t: number): void;
}

const ROCK = ['#f7b6d2', '#ffd6a5', '#cdb4ff', '#a0e7e5', '#ffc6a5', '#b9f0c4'];
const ROCK_DARK = ['#e48fb6', '#f0b878', '#a98ff0', '#6fcfcb', '#f0a07a', '#86d79c'];
const HOLD_COLS = ['#ff4fa3', '#ffd23f', '#22c4e8', '#3ccf7a', '#7b4dff', '#ff8a3d'];

interface Spire {
  c: THREE.Vector3; // centre at ground
  top: number;
  w: number;
  d: number;
  rot: number;
}

export function buildMountain(R: typeof RAPIER, world: RAPIER.World, scene: THREE.Scene, seed = 20261116): Mountain {
  const rnd = mulberry(seed);
  const range = (a: number, b: number) => a + rnd() * (b - a);
  const fixedBox = (half: THREE.Vector3, at: THREE.Vector3, rotY: number) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
    const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(at.x, at.y, at.z).setRotation(q));
    world.createCollider(R.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(0.9), body);
  };

  // ---- meadow
  const meadow = new THREE.Mesh(new THREE.CylinderGeometry(42, 42, 1, 48), toon('#9be59a'));
  meadow.position.y = -0.5;
  meadow.receiveShadow = true;
  scene.add(meadow);
  const mb = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(R.ColliderDesc.cylinder(0.5, 42).setFriction(0.9), mb);

  // ---- the route: spires winding upward
  const N = 17;
  const spires: Spire[] = [];
  let dir = rnd() * Math.PI * 2;
  let top = 2.2;
  let c = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < N; i++) {
    const last = i === N - 1;
    const w = last ? 3.4 : range(1.7, 2.6);
    const d = last ? 3.4 : range(1.7, 2.6);
    if (i > 0) {
      const prev = spires[i - 1];
      dir += range(-0.85, 0.85);
      // stay roughly near the middle so the crag reads as one place
      if (c.length() > 14) dir = Math.atan2(-c.x, -c.z) + range(-0.5, 0.5);
      const gap = range(1.1, 2.1) + (i > 10 ? 0.3 : 0);
      const dist = (Math.max(prev.w, prev.d) + Math.max(w, d)) * 0.42 + gap;
      c = c.clone().add(new THREE.Vector3(Math.sin(dir) * dist, 0, Math.cos(dir) * dist));
      top += range(2.6, 4.4);
    }
    spires.push({ c, top, w, d, rot: rnd() * Math.PI });
  }

  const holds: Hold[] = [];
  const holdGeo = new THREE.IcosahedronGeometry(0.11, 0);
  const holdMats = HOLD_COLS.map((col) => toon(col, {}, 0.3));
  const strata = (i: number, k: number) => toon(k % 2 ? ROCK_DARK[i % ROCK_DARK.length] : ROCK[i % ROCK.length], {}, 0.5);

  spires.forEach((s, i) => {
    // stack of offset rock blocks from the ground to the top: real ledges, bulges and corners
    let y = 0;
    let k = 0;
    while (y < s.top - 0.01) {
      const h = Math.min(s.top - y, range(1.6, 3.2));
      const shrink = 1 - (y / Math.max(1, s.top)) * 0.18; // spires taper a little
      const bw = s.w * shrink * range(0.88, 1.08);
      const bd = s.d * shrink * range(0.88, 1.08);
      const off = new THREE.Vector3(range(-0.22, 0.22), 0, range(-0.22, 0.22));
      const rot = s.rot + range(-0.25, 0.25);
      const at = new THREE.Vector3(s.c.x + off.x, y + h / 2, s.c.z + off.z);
      const geo = new THREE.BoxGeometry(bw, h, bd, 1, 1, 1);
      // nudge corners for a chiselled low-poly rock look (visual only; collider stays a box)
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        if (pos.getY(v) > 0 && y + h >= s.top - 0.01) continue; // keep the top ledge flat to stand on
        pos.setX(v, pos.getX(v) * range(0.94, 1.04));
        pos.setZ(v, pos.getZ(v) * range(0.94, 1.04));
      }
      geo.computeVertexNormals();
      const faceted = geo.toNonIndexed();
      faceted.computeVertexNormals(); // per-face normals = flat low-poly rock
      const m = new THREE.Mesh(faceted, strata(i, k));
      m.position.copy(at);
      m.rotation.y = rot;
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      fixedBox(new THREE.Vector3(bw / 2, h / 2, bd / 2), at, rot);

      // holds on the faces of this block (skip the ground floor of the first spire's back)
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0));
      for (let hy = 0.8; hy < h - 0.2; hy += range(0.9, 1.3)) {
        const face = Math.floor(rnd() * 4);
        const along = range(-0.35, 0.35);
        const local = face === 0 ? new THREE.Vector3(along * bw, 0, bd / 2 + 0.04)
          : face === 1 ? new THREE.Vector3(along * bw, 0, -bd / 2 - 0.04)
          : face === 2 ? new THREE.Vector3(bw / 2 + 0.04, 0, along * bd)
          : new THREE.Vector3(-bw / 2 - 0.04, 0, along * bd);
        local.y = hy - h / 2;
        const hp = local.applyQuaternion(q).add(at);
        const hm = new THREE.Mesh(holdGeo, holdMats[(i + k + Math.floor(hy)) % holdMats.length]);
        hm.position.copy(hp);
        hm.scale.set(1.3, 0.8, 1);
        hm.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        hm.castShadow = true;
        scene.add(hm);
        holds.push({ pos: hp, mesh: hm, cooldown: 0 });
      }
      y += h;
      k++;
    }
  });

  // ---- route furniture
  const checkpoints: Checkpoint[] = [];
  const berries: Berry[] = [];
  const pads: Pad[] = [];
  const rings: Ring[] = [];
  const movers: Mover[] = [];
  const bobbers: { o: THREE.Object3D; base: number; ph: number }[] = [];
  const spinners: THREE.Object3D[] = [];

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

  // start: on the meadow beside the first spire
  const s0 = spires[0];
  const away = new THREE.Vector3(Math.sin(s0.rot), 0, Math.cos(s0.rot));
  const start = s0.c.clone().addScaledVector(away, Math.max(s0.w, s0.d) * 0.5 + 2.2);
  start.y = 0;
  addCheckpoint(start);

  const berryGeo = new THREE.IcosahedronGeometry(0.16, 1);
  const berryMat = jelly('#ff4f7a', { opacity: 0.9, glow: 0.6 });
  spires.forEach((s, i) => {
    const topPos = new THREE.Vector3(s.c.x, s.top, s.c.z);
    if (i === spires.length - 1) return;
    if (i > 0 && i % 4 === 0) addCheckpoint(topPos.clone().add(new THREE.Vector3(0.35, 0, 0.35)));
    else if (i % 5 === 2) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), jelly('#ff6fae', { opacity: 0.85, glow: 0.5 }));
      dome.scale.y = 0.35;
      dome.position.copy(topPos);
      scene.add(dome);
      pads.push({ pos: topPos.clone(), r: 0.6, dome, squish: 0 });
    } else if (rnd() < 0.5) {
      const b = new THREE.Mesh(berryGeo, berryMat);
      const bp = topPos.clone().add(new THREE.Vector3(0, 0.45, 0));
      b.position.copy(bp);
      scene.add(b);
      berries.push({ pos: bp, mesh: b, taken: false, respawn: 0 });
      spinners.push(b);
    }
    // a hoop hanging over every third gap
    if (i % 3 === 1) {
      const n = spires[i + 1];
      const mid = new THREE.Vector3((s.c.x + n.c.x) / 2, Math.max(s.top, n.top) + 0.9, (s.c.z + n.c.z) / 2);
      const tangent = new THREE.Vector3(n.c.x - s.c.x, 0, n.c.z - s.c.z).normalize();
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.11, 10, 24), toon(HOLD_COLS[i % HOLD_COLS.length]));
      hoop.position.copy(mid);
      hoop.lookAt(mid.clone().add(tangent));
      hoop.castShadow = true;
      scene.add(hoop);
      rings.push({ pos: mid, normal: tangent, mesh: hoop, cooldown: 0 });
    }
  });

  // ---- summit: last spire + flag
  const last = spires[spires.length - 1];
  const height = last.top;
  const summit = new THREE.Vector3(last.c.x, last.top, last.c.z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8), toon('#ffffff'));
  pole.position.set(summit.x, summit.y + 1.2, summit.z);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7, 8, 1), toon('#ff4fa3', { side: THREE.DoubleSide }));
  flag.position.set(summit.x + 0.55, summit.y + 2, summit.z);
  scene.add(pole, flag);

  // ---- bounds for scenery
  let clearR = 0;
  for (const s of spires) clearR = Math.max(clearR, s.c.length() + Math.max(s.w, s.d));
  clearR = Math.max(clearR, start.length() + 2);

  // ---- floating candy shapes up in the sky around the crag (no colliders)
  const shapes = [new THREE.TorusGeometry(0.8, 0.28, 10, 20), new THREE.OctahedronGeometry(0.9), new THREE.TorusKnotGeometry(0.6, 0.2, 48, 8)];
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(shapes[i % shapes.length], toon(ROCK_DARK[i % ROCK_DARK.length]));
    const a = rnd() * Math.PI * 2;
    const r = clearR + 4 + rnd() * 12;
    m.position.set(Math.sin(a) * r, 6 + rnd() * height, Math.cos(a) * r);
    scene.add(m);
    spinners.push(m);
    bobbers.push({ o: m, base: m.position.y, ph: rnd() * 6 });
  }

  return {
    clearR,
    height,
    summit,
    start,
    checkpoints,
    berries,
    pads,
    movers,
    rings,
    holds,
    stepMovers() {
      /* no swinging rafts on the crag route */
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
        p.squish = Math.max(0, p.squish - dt * 2.5);
        const s = Math.sin(p.squish * 14) * p.squish;
        p.dome.scale.set(1 + s * 0.4, 0.35 * (1 - s * 1.2), 1 + s * 0.4);
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
