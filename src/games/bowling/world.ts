import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { toon } from '../../core/toon.ts';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Real-world dimensions in metres / kilograms
export const LANE_HALF_W = 0.53;
export const GUTTER_W = 0.24;
export const HEAD_PIN_Z = -18.29;
export const PIN_SPACING = 0.3048;
export const DECK_END_Z = -19.45;
export const PIT_BACK_Z = -21;
export const BALL_R = 0.109;
export const BALL_MASS = 6.5;
export const PIN_H = 0.381;
export const PIT_FLOOR_Y = -0.5;
export const PIT_HALF_W = 1.0;
export const PIT_TILT = 0.06; // radians, low side toward the lift (-x)
/** Ball lift machine, just outside the pit's left back corner. */
export const LIFT = { x: -(PIT_HALF_W + 0.28), z: PIT_BACK_Z + 0.45, top: 1.05 };
const KICK_CZ = (HEAD_PIN_Z + 1 + PIT_BACK_Z) / 2;
const KICK_HZ = (HEAD_PIN_Z + 1 - PIT_BACK_Z) / 2;

/** Home spots for pins 1..10 (row by row from the head pin). */
export function pinSpots(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const rowDz = PIN_SPACING * Math.sin(Math.PI / 3);
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k <= row; k++) {
      out.push(new THREE.Vector3((k - row / 2) * PIN_SPACING, 0, HEAD_PIN_Z - row * rowDz));
    }
  }
  return out;
}

function fixedBox(
  R: typeof RAPIER,
  world: RAPIER.World,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  friction = 0.5,
  restitution = 0.1,
): void {
  const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(cx, cy, cz));
  world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction).setRestitution(restitution).setRestitutionCombineRule(R.CoefficientCombineRule.Max), body);
}

function boxMesh(
  scene: THREE.Object3D, mat: THREE.Material,
  cx: number, cy: number, cz: number, hx: number, hy: number, hz: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
  m.position.set(cx, cy, cz);
  m.receiveShadow = true;
  m.castShadow = true;
  scene.add(m);
  return m;
}

function laneTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 2048;
  const g = c.getContext('2d')!;
  const boards = 39;
  for (let i = 0; i < boards; i++) {
    const shade = 210 + ((i * 37) % 3) * 12;
    g.fillStyle = `rgb(${shade + 20}, ${shade - 30}, ${shade - 110})`;
    g.fillRect((i / boards) * c.width, 0, c.width / boards + 1, c.height);
  }
  // subtle grain
  g.globalAlpha = 0.07;
  for (let i = 0; i < 400; i++) {
    g.fillStyle = Math.random() > 0.5 ? '#fff' : '#7a4a10';
    g.fillRect(Math.random() * c.width, Math.random() * c.height, 1, 30 + Math.random() * 120);
  }
  g.globalAlpha = 1;
  // texture spans z from +4 (top, v=1) to DECK_END_Z (bottom, v=0)
  const len = 4 - DECK_END_Z;
  const yAt = (z: number) => ((4 - z) / len) * c.height;
  // foul line
  g.fillStyle = '#ff5fa2';
  g.fillRect(0, yAt(0) - 4, c.width, 8);
  // dots and arrows
  g.fillStyle = '#7b3fe4';
  for (let k = -3; k <= 3; k++) {
    const x = c.width / 2 + k * (c.width / boards) * 5;
    g.beginPath();
    g.arc(x, yAt(-2.1), 3, 0, Math.PI * 2);
    g.fill();
    const zA = -4.6 - Math.abs(k) * 0.3;
    g.beginPath();
    g.moveTo(x, yAt(zA) - 22);
    g.lineTo(x - 7, yAt(zA) + 10);
    g.lineTo(x + 7, yAt(zA) + 10);
    g.closePath();
    g.fill();
  }
  // pin deck tint
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, yAt(HEAD_PIN_Z + 0.4), c.width, c.height);
  // pin spots
  g.fillStyle = 'rgba(123,63,228,0.5)';
  for (const p of pinSpots()) {
    g.beginPath();
    g.arc(c.width / 2 + (p.x / (LANE_HALF_W * 2)) * c.width, yAt(p.z), 4, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function stripeTexture(a: string, b: string, repeat: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = b;
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 16 + 64, 64);
    g.lineTo(i + 64, 64);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, 1);
  return t;
}

function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#5ec8ff');
  grad.addColorStop(0.55, '#bfe9ff');
  grad.addColorStop(1, '#ffd6ec');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Builds the static arena: visuals into `scene`, colliders into `world`. */
export function buildArena(R: typeof RAPIER, world: RAPIER.World, scene: THREE.Scene): Arena {
  scene.background = skyTexture();
  scene.fog = new THREE.Fog('#d9f0ff', 30, 70);

  const hemi = new THREE.HemisphereLight('#ffffff', '#ffc9e6', 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff6e0', 2.2);
  sun.position.set(4, 9, 3);
  sun.target.position.set(0, 0, -9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -14; sc.right = 14; sc.top = 6; sc.bottom = -6; sc.near = 1; sc.far = 30;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const laneLen = 4 - DECK_END_Z;
  const laneCz = (4 + DECK_END_Z) / 2;

  // --- Physics ---
  fixedBox(R, world, 0, -0.1, laneCz, LANE_HALF_W, 0.1, laneLen / 2, 0.08); // oiled lane
  fixedBox(R, world, 0, -0.1, 2.5, 1.8, 0.1, 1.5, 0.6); // approach
  for (const sx of [-1, 1]) {
    const gx = sx * (LANE_HALF_W + GUTTER_W / 2);
    fixedBox(R, world, gx, -0.17, (0 + DECK_END_Z) / 2, GUTTER_W / 2, 0.1, -DECK_END_Z / 2, 0.3);
    const wx = sx * (LANE_HALF_W + GUTTER_W + 0.03);
    fixedBox(R, world, wx, 0, DECK_END_Z / 2, 0.03, 0.15, -DECK_END_Z / 2, 0.3, 0.92); // bouncy lane divider (padded bumper)
    fixedBox(R, world, wx, 0.2, KICK_CZ, 0.03, 0.35, KICK_HZ, 0.3, 0.6); // kickback walls by the deck: pins ricochet back in
  }
  // pit floor tilts toward the ball lift (-x) so balls roll to the machine
  {
    const body = world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(0, PIT_FLOOR_Y - 0.1, (DECK_END_Z + PIT_BACK_Z) / 2)
        .setRotation(quatZ(PIT_TILT)),
    );
    world.createCollider(R.ColliderDesc.cuboid(PIT_HALF_W, 0.1, (DECK_END_Z - PIT_BACK_Z) / 2 + 0.2).setFriction(0.4), body);
  }
  for (const sx of [-1, 1]) fixedBox(R, world, sx * (PIT_HALF_W + 0.05), -0.1, (DECK_END_Z + PIT_BACK_Z) / 2, 0.05, 0.5, (DECK_END_Z - PIT_BACK_Z) / 2, 0.5);
  fixedBox(R, world, 0, 0.3, PIT_BACK_Z - 0.1, PIT_HALF_W + 0.1, 1.0, 0.1, 0.8); // back cushion

  // --- Visuals ---
  const laneMat = new THREE.MeshStandardMaterial({ map: laneTexture(), roughness: 0.22, metalness: 0 });
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(LANE_HALF_W * 2, laneLen), laneMat);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0, laneCz);
  lane.receiveShadow = true;
  scene.add(lane);
  const platform = buildLanePlatform(scene, laneCz, laneLen);

  const gutterMat = toon('#b9a3ff');
  const wallMat = new THREE.MeshToonMaterial({ map: stripeTexture('#ff5fa2', '#fffaf2', 40) });
  for (const sx of [-1, 1]) {
    const gx = sx * (LANE_HALF_W + GUTTER_W / 2);
    boxMesh(scene, gutterMat, gx, -0.17, DECK_END_Z / 2, GUTTER_W / 2, 0.1, -DECK_END_Z / 2);
    const wx = sx * (LANE_HALF_W + GUTTER_W + 0.03);
    boxMesh(scene, wallMat, wx, 0, DECK_END_Z / 2, 0.03, 0.15, -DECK_END_Z / 2);
  }
  const deck = buildPinDeck(scene);

  // ground far below + playful scenery
  const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 48), toon('#a6f0c6'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.7;
  ground.receiveShadow = true;
  scene.add(ground);

  const scenery = buildScenery(scene);
  return {
    update(dt: number) {
      deck.update(dt);
      scenery.update(dt);
      platform.update(dt);
    },
    react(kind: Reaction) {
      deck.react(kind);
      platform.react(kind);
    },
    setRolling(on: boolean) {
      platform.setRolling(on);
    },
  };
}

export type Reaction = 'strike' | 'spare' | 'gutter' | 'split' | 'hit' | 'turkey';
export interface Arena {
  update(dt: number): void;
  react(kind: Reaction): void;
  setRolling(on: boolean): void;
}

/**
 * The lane sits on a chunky rounded candy platform: a striped skirt, a bumper rim and a row of
 * bulbs down each side that chase toward the pins while a ball rolls and flash on big results.
 */
function buildLanePlatform(scene: THREE.Scene, laneCz: number, laneLen: number) {
  const halfW = LANE_HALF_W + GUTTER_W + 0.08;
  const len = laneLen - 4; // from the foul line to the deck end
  const cz = (0 + DECK_END_Z) / 2;
  // lane slab under the boards
  const slab = new THREE.Mesh(new THREE.BoxGeometry(LANE_HALF_W * 2, 0.2, laneLen), toon('#e7b26a', {}, 0.3));
  slab.position.set(0, -0.11, laneCz);
  slab.receiveShadow = true;
  slab.userData.noInk = true;
  scene.add(slab);
  // chunky platform body
  const skirtTex = verticalStripes('#b78cff', '#9a6cff', 2);
  skirtTex.wrapS = THREE.RepeatWrapping;
  skirtTex.repeat.set(60, 1);
  const body = new THREE.Mesh(new RoundedBoxGeometry(halfW * 2, 0.5, len + 0.3, 4, 0.12), toon('#ffffff', { map: skirtTex }, 0.3));
  body.position.set(0, -0.48, cz);
  body.receiveShadow = true;
  scene.add(body);
  const rimMat = toon('#ffd23f', {}, 0.25);
  for (const sx of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, len, 6, 10), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(sx * halfW, -0.24, cz);
    rim.castShadow = true;
    scene.add(rim);
  }
  // approach: rounded cream deck with a pink lip, split around the lane
  const approachMat = toon('#ffe8b8', {}, 0.35);
  const lipMat = toon('#ff8fd0', {}, 0.25);
  for (const sx of [-1, 1]) {
    const a = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.6, 4.2, 4, 0.1), approachMat);
    a.position.set(sx * (LANE_HALF_W + 0.64), -0.31, 2.05);
    a.receiveShadow = true;
    scene.add(a);
    const lip = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 4.0, 6, 10), lipMat);
    lip.rotation.x = Math.PI / 2;
    lip.position.set(sx * (LANE_HALF_W + 1.29), -0.02, 2.05);
    scene.add(lip);
  }
  const front = new THREE.Mesh(new RoundedBoxGeometry(LANE_HALF_W * 2, 0.6, 0.3, 3, 0.08), approachMat);
  front.position.set(0, -0.31, 4.0);
  scene.add(front);

  // chase lights along both sides
  const bulbGeo = new THREE.SphereGeometry(0.035, 10, 8);
  const bulbs: THREE.Mesh[] = [];
  const n = 34;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: '#fff3b0' }));
      b.position.set(sx * (halfW + 0.02), -0.33, -0.2 - (i / (n - 1)) * (len - 0.4));
      b.userData.i = i;
      b.userData.noInk = true;
      bulbs.push(b);
      scene.add(b);
    }
  }
  const cols = ['#ff5fa2', '#ffd23f', '#3fd6ff', '#8be36b', '#b78cff'];
  let t = 0;
  let rolling = false;
  let flash = 0;
  let flashCol = '#ffd23f';
  const c = new THREE.Color();
  return {
    update(dt: number) {
      t += dt;
      flash = Math.max(0, flash - dt * 0.6);
      for (const b of bulbs) {
        const i = b.userData.i as number;
        const mat = b.material as THREE.MeshBasicMaterial;
        if (flash > 0) {
          const on = Math.sin(t * 22 + i) > 0;
          mat.color.set(on ? flashCol : '#ffffff');
          b.scale.setScalar(on ? 1.5 : 1);
        } else if (rolling) {
          // a wave racing toward the pins
          const w = Math.sin(i * 0.6 - t * 14);
          mat.color.copy(c.set(cols[i % cols.length])).multiplyScalar(w > 0.6 ? 1 : 0.45);
          b.scale.setScalar(w > 0.6 ? 1.4 : 1);
        } else {
          const w = 0.6 + 0.4 * Math.sin(t * 1.5 + i * 0.35);
          mat.color.set('#fff3b0').multiplyScalar(w);
          b.scale.setScalar(1);
        }
      }
    },
    setRolling(on: boolean) {
      rolling = on;
    },
    react(kind: Reaction) {
      if (kind === 'hit') return;
      flash = kind === 'strike' || kind === 'turkey' ? 2.2 : kind === 'spare' ? 1.4 : 0.8;
      flashCol = kind === 'gutter' ? '#9a8fb5' : kind === 'split' ? '#3fd6ff' : kind === 'spare' ? '#3fd6ff' : '#ffd23f';
    },
  };
}

/** Candy bench: squishy rounded seat and backrest on stubby legs. Seat top is at `seatTop`. */
export function makeCandyBench(seatCol = '#ff8fd0', backCol = '#ffd23f'): { group: THREE.Group; seatTop: number } {
  const g = new THREE.Group();
  const seatMat = toon(seatCol, {}, 0.35);
  const seat = new THREE.Mesh(new RoundedBoxGeometry(1.25, 0.12, 0.42, 3, 0.05), seatMat);
  seat.position.y = 0.36;
  const cushionMat = toon('#ffffff', {}, 0.25);
  for (const x of [-0.3, 0.3]) {
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.06, 0.36, 3, 0.03), cushionMat);
    cushion.position.set(x, 0.44, 0.0);
    g.add(cushion);
  }
  const back = new THREE.Mesh(new RoundedBoxGeometry(1.25, 0.34, 0.1, 3, 0.05), toon(backCol, {}, 0.35));
  back.position.set(0, 0.62, 0.19);
  back.rotation.x = -0.12;
  const legMat = toon('#3fd6ff', {}, 0.3);
  for (const x of [-0.52, 0.52]) for (const z of [-0.14, 0.14]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.32, 10), legMat);
    leg.position.set(x, 0.16, z);
    g.add(leg);
  }
  for (const m of [seat, back]) g.add(m);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
  });
  return { group: g, seatTop: 0.47 };
}

function quatZ(a: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) };
}

function verticalStripes(a: string, b: string, n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d')!;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 ? b : a;
    g.fillRect((i / n) * 64, 0, 64 / n + 1, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function conveyorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3b2670';
  g.fillRect(0, 0, 64, 16);
  g.fillStyle = '#5a3fa0';
  for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 6, 16);
  g.fillStyle = '#ffd23f';
  for (let x = 8; x < 64; x += 16) {
    // little chevrons pointing toward the lift (-x)
    g.fillRect(x + 2, 6, 2, 4);
    g.fillRect(x + 4, 4, 2, 2);
    g.fillRect(x + 4, 10, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * The machine end of the lane: padded candy kickbacks, a conveyor pit that tilts toward the
 * ball lift, a ribbon curtain, and "Pinbot", a friendly pinsetter head watching the pins.
 */
function buildPinDeck(scene: THREE.Scene): { update(dt: number): void; react(kind: Reaction): void } {
  const pitCz = (DECK_END_Z + PIT_BACK_Z) / 2;
  const pitLen = DECK_END_Z - PIT_BACK_Z;

  // Kickbacks: striped padded panels with a round bumper on top
  const panelTex = verticalStripes('#ff5fa2', '#fffaf2', 16);
  panelTex.wrapS = THREE.RepeatWrapping;
  panelTex.repeat.set(3, 1);
  const panelMat = toon('#ffffff', { map: panelTex }, 0.25);
  const bumperMat = toon('#3fd6ff', {}, 0.3);
  for (const sx of [-1, 1]) {
    const wx = sx * (LANE_HALF_W + GUTTER_W + 0.03);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, KICK_HZ * 2), panelMat);
    panel.position.set(wx + sx * 0.02, 0.2, KICK_CZ);
    panel.castShadow = panel.receiveShadow = true;
    const bumper = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, KICK_HZ * 2 - 0.1, 6, 12), bumperMat);
    bumper.rotation.x = Math.PI / 2;
    bumper.position.set(wx + sx * 0.02, 0.58, KICK_CZ);
    bumper.castShadow = true;
    scene.add(panel, bumper);
  }

  // Conveyor pit floor (texture scrolls toward the lift)
  const conv = conveyorTexture();
  conv.repeat.set(6, 3);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(PIT_HALF_W * 2, 0.2, pitLen + 0.4), toon('#ffffff', { map: conv }, 0));
  floor.position.set(0, PIT_FLOOR_Y - 0.1, pitCz);
  floor.rotation.z = PIT_TILT;
  floor.receiveShadow = true;
  floor.userData.noInk = true;
  scene.add(floor);
  const pitWallMat = toon('#4a2f80', {}, 0.2);
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, pitLen), pitWallMat);
    w.position.set(sx * (PIT_HALF_W + 0.05), -0.1, pitCz);
    scene.add(w);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(PIT_HALF_W * 2 + 0.2, 2.0, 0.2), toon('#2a1b4a', {}, 0));
  back.position.set(0, 0.3, PIT_BACK_Z - 0.1);
  back.userData.noInk = true;
  scene.add(back);

  // Ribbon curtain
  const ribbons: THREE.Mesh[] = [];
  const ribbonCols = ['#ff5fa2', '#ffd23f', '#3fd6ff', '#8be36b', '#b78cff', '#ff8b4d'];
  const nRib = 18;
  for (let i = 0; i < nRib; i++) {
    const geo = new THREE.BoxGeometry((PIT_HALF_W * 2) / nRib - 0.01, 1.3, 0.02);
    geo.translate(0, -0.65, 0); // pivot at the top
    const r = new THREE.Mesh(geo, toon(ribbonCols[i % ribbonCols.length], {}, 0.3));
    r.position.set(-PIT_HALF_W + ((i + 0.5) / nRib) * PIT_HALF_W * 2, 0.85, PIT_BACK_Z + 0.08);
    r.userData.phase = i * 0.7;
    r.userData.noInk = true;
    ribbons.push(r);
    scene.add(r);
  }

  // Pinbot: the pinsetter head
  const bot = new THREE.Group();
  bot.position.set(0, 1.18, HEAD_PIN_Z - 0.8);
  scene.add(bot);
  const bodyMat = toon('#ffd23f', {}, 0.4);
  const head = new THREE.Mesh(new RoundedBoxGeometry(2.3, 0.6, 0.75, 4, 0.14), bodyMat);
  head.castShadow = true;
  bot.add(head);
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(2.32, 0.12, 0.77),
    new THREE.MeshToonMaterial({ map: stripeTexture('#ff8b4d', '#ffd23f', 12), gradientMap: toon('#fff').gradientMap }),
  );
  band.position.y = -0.2;
  bot.add(band);
  const faceZ = 0.38;
  const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const ink = toon('#2a1b4a', {}, 0);
  const eyes: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * 0.32, 0.06, faceZ);
    const ball = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), white);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), ink);
    pupil.position.set(0, -0.015, 0.003);
    const shine = new THREE.Mesh(new THREE.CircleGeometry(0.025, 12), white);
    shine.position.set(0.03, 0.03, 0.006);
    eye.add(ball, pupil, shine);
    eye.userData.pupil = pupil;
    bot.add(eye);
    eyes.push(eye);
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), toon('#ff7f9c', {}, 0));
    cheek.scale.set(1.4, 0.7, 1);
    cheek.position.set(sx * 0.55, -0.08, faceZ);
    bot.add(cheek);
  }
  const grill = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.1, 0.02, 2, 0.04), ink);
  grill.position.set(0, -0.08, faceZ);
  bot.add(grill);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), new THREE.MeshBasicMaterial({ color: '#ff5fa2' }));
  lamp.position.set(0, 0.36, 0);
  bot.add(lamp);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new RoundedBoxGeometry(0.18, 1.2, 0.3, 3, 0.06), bodyMat);
    leg.position.set(sx * 1.16, -0.6, 0);
    leg.castShadow = true;
    bot.add(leg);
  }
  for (const o of [...bot.children]) {
    const m = o as THREE.Mesh;
    if (m.isMesh && (m.geometry.type === 'CircleGeometry')) m.userData.noInk = true;
  }

  let t = 0;
  let blink = 3;
  // Pinbot reactions: squash-and-stretch bounce, happy squint, dizzy head-shake
  let mood: Reaction | null = null;
  let moodT = 0;
  let squashV = 0;
  let squash = 0;
  return {
    update(dt: number) {
      t += dt;
      moodT = Math.max(0, moodT - dt);
      if (moodT === 0) mood = null;
      conv.offset.x += dt * (mood === 'strike' || mood === 'turkey' ? 3 : 0.6);
      for (const r of ribbons) r.rotation.x = Math.sin(t * 1.7 + r.userData.phase) * (mood ? 0.25 : 0.05);
      blink -= dt;
      const shut = blink < 0.12;
      if (blink < 0) blink = 2.5 + Math.random() * 3;
      // jelly bounce spring
      squashV += (-squash * 180 - squashV * 9) * dt;
      squash += squashV * dt;
      bot.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);
      const happy = mood === 'strike' || mood === 'spare' || mood === 'turkey';
      for (const e of eyes) {
        e.scale.y = happy ? 0.35 : mood === 'gutter' ? 1.25 : shut ? 0.12 : 1;
        e.scale.x = mood === 'split' ? 1.3 : 1;
        const pupil = e.userData.pupil as THREE.Object3D;
        pupil.position.x = mood === 'gutter' ? Math.sin(t * 9) * 0.04 : Math.sin(t * 0.7) * 0.03;
        pupil.position.y = mood === 'gutter' ? Math.cos(t * 9) * 0.04 - 0.015 : -0.015;
      }
      (lamp.material as THREE.MeshBasicMaterial).color.setHSL((t * (mood ? 1.5 : 0.15)) % 1, 0.9, 0.62);
      lamp.position.y = 0.36 + (mood ? Math.abs(Math.sin(t * 12)) * 0.06 : 0);
      bot.position.y = 1.18 + Math.sin(t * 2) * 0.01 + (happy ? Math.abs(Math.sin(t * 9)) * 0.05 : 0);
      bot.rotation.z = mood === 'gutter' ? Math.sin(t * 14) * 0.05 * moodT : mood === 'split' ? Math.sin(t * 3) * 0.08 : 0;
    },
    react(kind: Reaction) {
      if (kind === 'hit') {
        squashV += 1.2;
        return;
      }
      mood = kind;
      moodT = kind === 'strike' || kind === 'turkey' ? 2.6 : 2;
      squashV += kind === 'gutter' ? -2.5 : 3.5;
    },
  };
}

export function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** White pin with two candy bands, origin at the base. */
export function pinGeometry(): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0.0001, 0], [0.026, 0], [0.034, 0.02], [0.048, 0.055], [0.058, 0.09], [0.0605, 0.115], [0.058, 0.145],
    [0.05, 0.18], [0.038, 0.215], [0.028, 0.245], [0.0235, 0.265], [0.025, 0.285], [0.03, 0.31],
    [0.0325, 0.33], [0.031, 0.35], [0.024, 0.368], [0.012, 0.378], [0.0001, PIN_H],
  ];
  const curve = new THREE.SplineCurve(prof.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getSpacedPoints(48);
  pts[0].set(0.0001, 0);
  pts[pts.length - 1].set(0.0001, PIN_H);
  const geo = new THREE.LatheGeometry(pts, 24);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const white = new THREE.Color('#fffaf2');
  const red = new THREE.Color('#ff3b6b');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const c = (y > 0.235 && y < 0.252) || (y > 0.268 && y < 0.285) ? red : white;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Pin rigid body: compound colliders, low centre of mass, total 1.5 kg. */
export function createPinBody(R: typeof RAPIER, world: RAPIER.World, p: THREE.Vector3): RAPIER.RigidBody {
  const body = world.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setLinearDamping(0.08)
      .setAngularDamping(0.12) // let knocked pins tumble and spin
      .setCcdEnabled(true) // fast pins can't tunnel through each other or the kickbacks
      .setCanSleep(true),
  );
  const mk = (desc: RAPIER.ColliderDesc, mass: number) =>
    world.createCollider(desc.setMass(mass).setFriction(0.3).setRestitution(0.38), body);
  // rounded shapes give smooth rolling contacts instead of snaggy cylinder edges
  mk(R.ColliderDesc.roundCylinder(0.022, 0.026, 0.008).setTranslation(0, 0.03, 0), 0.35);
  mk(R.ColliderDesc.ball(0.06).setTranslation(0, 0.12, 0), 0.75);
  mk(R.ColliderDesc.roundCylinder(0.045, 0.02, 0.006).setTranslation(0, 0.24, 0), 0.2);
  mk(R.ColliderDesc.ball(0.032).setTranslation(0, 0.335, 0), 0.2);
  return body;
}

// ---------------------------------------------------------------- abstract candy scenery
const SCENE_PALETTE = ['#ff6fae', '#5fd0ff', '#ffcf3f', '#8be36b', '#b78cff', '#ff8b4d', '#5ef2c2', '#ff8fd0'];

function starGeometry(r: number, depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 ? r * 0.48 : r;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: r * 0.08, bevelThickness: r * 0.08, bevelSegments: 2 });
  g.center();
  return g;
}

/**
 * Candy shapes and drifting clouds all around the arena. Placement keeps a clear corridor around
 * the lane, both machines, the benches and the camera paths, and nothing overlaps anything else.
 */
/**
 * Abstract candy scenery (shapes, balloons, clouds). `keepClear(x, z, r)` returns true where the
 * game's play area is, so nothing gets placed there; defaults to the bowling lane.
 */
export function buildScenery(
  scene: THREE.Scene,
  keepClear: (x: number, z: number, r: number) => boolean = (x, z, r) => x > -2.6 - r && x < 2.0 + r && z > -23 - r && z < 6.5 + r,
): { update(dt: number): void } {
  const rng = mulberry(11);
  const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)];
  const placed: { x: number; z: number; r: number }[] = [];
  const blocked = (x: number, z: number, r: number) => {
    if (keepClear(x, z, r)) return true;
    return placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.5);
  };
  const floaters: THREE.Object3D[] = [];

  const makeShape = (r: number): THREE.Mesh => {
    const mat = toon(pick(SCENE_PALETTE), {}, 0.55);
    const kind = Math.floor(rng() * 9);
    let geo: THREE.BufferGeometry;
    switch (kind) {
      case 0: geo = new THREE.SphereGeometry(r, 28, 18); break;
      case 1: geo = new THREE.TorusGeometry(r * 0.75, r * 0.28, 14, 30); break;
      case 2: geo = new THREE.CylinderGeometry(r * 0.7, r * 0.8, r * 2.2, 28); break;
      case 3: geo = new RoundedBoxGeometry(r * 1.5, r * 1.5, r * 1.5, 3, r * 0.25); break;
      case 4: geo = new THREE.ConeGeometry(r * 0.8, r * 2, 24); break;
      case 5: geo = new THREE.CapsuleGeometry(r * 0.45, r * 1.4, 8, 18); break;
      case 6: geo = starGeometry(r, r * 0.45); break;
      case 7: geo = new THREE.TorusGeometry(r, r * 0.22, 12, 30, Math.PI); break; // arch
      default: geo = new THREE.TorusKnotGeometry(r * 0.55, r * 0.17, 80, 12); break;
    }
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.kind = kind;
    return m;
  };

  const tryPlace = (xr: [number, number], zr: [number, number], rr: [number, number], tries = 40) => {
    for (let t = 0; t < tries; t++) {
      const r = rr[0] + rng() * (rr[1] - rr[0]);
      const x = xr[0] + rng() * (xr[1] - xr[0]);
      const z = zr[0] + rng() * (zr[1] - zr[0]);
      if (blocked(x, z, r)) continue;
      placed.push({ x, z, r });
      const m = makeShape(r);
      const float = rng() < 0.35;
      const groundY = -0.7;
      if (float) {
        m.position.set(x, 1.6 + rng() * 3.5 + r, z);
        m.userData.bob = rng() * 6;
        m.userData.spin = (rng() - 0.5) * 0.6;
        m.userData.baseY = m.position.y;
        floaters.push(m);
      } else {
        const k = m.userData.kind as number;
        const lift = k === 2 ? r * 1.1 : k === 4 ? r : k === 7 ? 0 : k === 1 ? r * 0.75 : r * 0.75;
        m.position.set(x, groundY + lift, z);
        if (k === 1 || k === 7 || k === 6) m.rotation.y = rng() * Math.PI;
        else m.rotation.set((rng() - 0.5) * 0.4, rng() * Math.PI, (rng() - 0.5) * 0.4);
        if (k === 5) m.rotation.z = Math.PI / 2 * (rng() < 0.5 ? 1 : 0.2);
      }
      scene.add(m);
      return;
    }
  };

  // both sides of the lane, near and far
  for (let i = 0; i < 26; i++) tryPlace([-18, -3], [-36, 8], [0.5, 1.4]);
  for (let i = 0; i < 26; i++) tryPlace([2.5, 18], [-36, 8], [0.5, 1.4]);
  // behind the bowler (the backdrop of reaction / setup shots)
  for (let i = 0; i < 22; i++) tryPlace([-14, 14], [7, 26], [0.45, 1.3]);
  // far ring for depth
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2;
    const d = 26 + rng() * 10;
    tryPlace([Math.cos(a) * d - 1, Math.cos(a) * d + 1], [Math.sin(a) * d - 8, Math.sin(a) * d - 6], [1.5, 3]);
  }

  // balloons over the sides
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.33, 20, 14), toon(SCENE_PALETTE[i % SCENE_PALETTE.length], {}, 0.4));
    b.scale.y = 1.2;
    b.position.set(side * (3 + rng() * 5), 3 + rng() * 3, 4 - rng() * 26);
    b.userData.bob = rng() * 6;
    b.userData.baseY = b.position.y;
    b.userData.spin = 0;
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 6), b.material);
    knot.position.y = -0.36;
    knot.rotation.x = Math.PI;
    b.add(knot);
    floaters.push(b);
    scene.add(b);
  }

  // puffy clouds drifting across the sky
  const cloudMat = toon('#ffffff', {}, 0.15);
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    const puffs = 4 + Math.floor(rng() * 4);
    for (let k = 0; k < puffs; k++) {
      const pr = 0.8 + rng() * 1.1;
      const p = new THREE.Mesh(new THREE.SphereGeometry(pr, 18, 12), cloudMat);
      p.position.set((k - puffs / 2) * 1.1 + rng() * 0.4, rng() * 0.5, (rng() - 0.5) * 1.2);
      p.scale.y = 0.72;
      p.castShadow = false;
      c.add(p);
    }
    let cx = 0, cz = 0;
    for (let tries = 0; tries < 12; tries++) {
      cx = -45 + rng() * 90;
      cz = -45 + rng() * 75;
      if (!keepClear(cx, cz, 6)) break;
    }
    c.position.set(cx, 8 + rng() * 7, cz);
    c.scale.setScalar(0.8 + rng() * 0.9);
    c.userData.speed = 0.25 + rng() * 0.4;
    clouds.push(c);
    scene.add(c);
  }

  let t = 0;
  return {
    update(dt: number) {
      t += dt;
      for (const o of floaters) {
        o.position.y = o.userData.baseY + Math.sin(t * 0.9 + o.userData.bob) * 0.18;
        o.rotation.y += o.userData.spin * dt;
      }
      for (const c of clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 48) c.position.x = -48;
      }
    },
  };
}
