import * as THREE from 'three';
import { toon } from '../core/toon.ts';
import { Spring } from './rig.ts';
import { gummy, makeWobble, buildTreat, treatFor, type Wobble } from './gummy.ts';

/**
 * JellyFolk: little astronauts with an animal's head inside a glass bubble helmet, a puffy space
 * suit (chest control panel, backpack with antenna, gloves) and jellyfish tentacles for legs.
 * Every animal is a recipe (ears, muzzle, markings, tail) on the same rigged astronaut body.
 *
 * Rig: hips (lean/twist/hop) -> body (squash) -> neck (spring jiggle) -> head,
 * shoulders -> arms -> hand, tail (wag), six skinned tentacles with follow-through springs.
 */

type EarKind = 'tri' | 'bigtri' | 'round' | 'biground' | 'floppy' | 'long' | 'side' | 'tufts' | 'none';
type TailKind = 'curl' | 'short' | 'tuft' | 'bushy' | 'puff' | 'curly' | 'thin' | 'feather' | 'none';
type Extra =
  | 'whiskers' | 'foreheadStripes' | 'tongue' | 'patch' | 'mane' | 'stripes' | 'eyepatch' | 'mask' | 'spots'
  | 'horns' | 'horn' | 'rainbowMane' | 'antlers' | 'snout' | 'cheeks' | 'buckteeth' | 'wool' | 'beak' | 'bill'
  | 'faceMask' | 'face' | 'cheekfluff' | 'crest' | 'frogeyes' | 'owleyes' | 'smile' | 'bignose' | 'ringtail' | 'freckles';

interface AnimalSpec {
  id: string;
  name: string;
  emoji: string;
  fur: string;
  light: string;
  ear: EarKind;
  earColor?: string;
  inner?: string;
  /** muzzle size (0 = none) */
  muzzle: number;
  muzzleColor?: string;
  nose?: string;
  tail: TailKind;
  tailColor?: string;
  accent?: string;
  extras: Extra[];
  /** bigger helmet for tall ears / horns */
  helmet?: number;
}

const DARK = '#2a1b4a';
const PINK = '#ffb3c1';

export const ANIMALS: AnimalSpec[] = [
  { id: 'cat', name: 'JellyCat', emoji: '🐱', fur: '#ff7a3d', light: '#fff3e6', ear: 'tri', muzzle: 1, nose: '#ff7f9c', tail: 'curl', accent: '#d9531c', extras: ['whiskers', 'foreheadStripes'] },
  { id: 'dog', name: 'JellyDog', emoji: '🐶', fur: '#d9a066', light: '#fff4e6', ear: 'floppy', earColor: '#8a5a3c', muzzle: 1.15, nose: DARK, tail: 'short', extras: ['tongue', 'patch'] },
  { id: 'lion', name: 'JellyLion', emoji: '🦁', fur: '#f5bf4f', light: '#fff1cf', ear: 'round', muzzle: 1, nose: '#c8486a', tail: 'tuft', accent: '#c8642a', extras: ['mane', 'whiskers'] },
  { id: 'tiger', name: 'JellyTiger', emoji: '🐯', fur: '#ff8a2a', light: '#fff6ea', ear: 'tri', muzzle: 1, nose: '#ff7f9c', tail: 'curl', extras: ['stripes', 'whiskers', 'ringtail'] },
  { id: 'bear', name: 'JellyBear', emoji: '🐻', fur: '#a8714a', light: '#e8c9a0', ear: 'round', muzzle: 1.1, nose: DARK, tail: 'short', extras: [] },
  { id: 'panda', name: 'JellyPanda', emoji: '🐼', fur: '#ffffff', light: '#ffffff', ear: 'round', earColor: DARK, muzzle: 0.9, nose: DARK, tail: 'short', extras: ['eyepatch'] },
  { id: 'fox', name: 'JellyFox', emoji: '🦊', fur: '#ff7b2e', light: '#fff6ea', ear: 'bigtri', inner: '#fff6ea', muzzle: 1.05, nose: DARK, tail: 'bushy', extras: ['cheekfluff'] },
  { id: 'bunny', name: 'JellyBunny', emoji: '🐰', fur: '#f6e7f0', light: '#ffffff', ear: 'long', muzzle: 0.85, nose: '#ff7f9c', tail: 'puff', extras: ['buckteeth', 'cheeks'], helmet: 0.34 },
  { id: 'frog', name: 'JellyFrog', emoji: '🐸', fur: '#6bd36b', light: '#e6ffd0', ear: 'none', muzzle: 0, tail: 'none', extras: ['frogeyes', 'smile', 'freckles'] },
  { id: 'pig', name: 'JellyPig', emoji: '🐷', fur: '#ffb3c7', light: '#ffd6e2', ear: 'tri', inner: '#ff8fae', muzzle: 0, tail: 'curly', extras: ['snout'] },
  { id: 'cow', name: 'JellyCow', emoji: '🐮', fur: '#ffffff', light: '#ffd1dc', ear: 'side', earColor: '#ffffff', muzzle: 1.3, muzzleColor: '#ffc0cf', tail: 'tuft', accent: DARK, extras: ['spots', 'horns'], helmet: 0.29 },
  { id: 'mouse', name: 'JellyMouse', emoji: '🐭', fur: '#b8b8c8', light: '#ececf4', ear: 'biground', muzzle: 0.9, nose: '#ff7f9c', tail: 'thin', extras: ['whiskers', 'buckteeth'], helmet: 0.29 },
  { id: 'koala', name: 'JellyKoala', emoji: '🐨', fur: '#9aa3ad', light: '#e9edf2', ear: 'biground', inner: '#ffffff', muzzle: 0, tail: 'none', extras: ['bignose'], helmet: 0.29 },
  { id: 'monkey', name: 'JellyMonkey', emoji: '🐵', fur: '#8a5a3c', light: '#f0c9a0', ear: 'side', earColor: '#f0c9a0', muzzle: 0, nose: DARK, tail: 'curl', extras: ['face'] },
  { id: 'raccoon', name: 'JellyRaccoon', emoji: '🦝', fur: '#8e8e9c', light: '#efefef', ear: 'tri', inner: '#efefef', muzzle: 0.95, nose: DARK, tail: 'bushy', extras: ['mask', 'ringtail'] },
  { id: 'sheep', name: 'JellySheep', emoji: '🐑', fur: '#f4e9dc', light: '#fff9f2', ear: 'side', earColor: '#6b5a7a', muzzle: 0.9, nose: '#ff7f9c', tail: 'puff', extras: ['wool'] },
  { id: 'penguin', name: 'JellyPenguin', emoji: '🐧', fur: '#2e3356', light: '#ffffff', ear: 'none', muzzle: 0, tail: 'feather', extras: ['faceMask', 'beak', 'cheeks'] },
  { id: 'owl', name: 'JellyOwl', emoji: '🦉', fur: '#a0703f', light: '#f5deb3', ear: 'tufts', muzzle: 0, tail: 'feather', extras: ['owleyes', 'beak'] },
  { id: 'duck', name: 'JellyDuck', emoji: '🦆', fur: '#ffe14d', light: '#fff6c0', ear: 'none', muzzle: 0, tail: 'feather', extras: ['bill', 'cheeks'] },
  { id: 'chick', name: 'JellyChick', emoji: '🐤', fur: '#ffd93d', light: '#fff2a8', ear: 'none', muzzle: 0, tail: 'feather', extras: ['beak', 'crest', 'cheeks'] },
  { id: 'unicorn', name: 'JellyUnicorn', emoji: '🦄', fur: '#ffffff', light: '#fff0fa', ear: 'tri', muzzle: 1.1, nose: PINK, tail: 'tuft', accent: '#b78cff', extras: ['horn', 'rainbowMane'], helmet: 0.33 },
  { id: 'deer', name: 'JellyDeer', emoji: '🦌', fur: '#c48a52', light: '#fff1de', ear: 'side', earColor: '#c48a52', muzzle: 1, nose: DARK, tail: 'puff', extras: ['antlers', 'freckles'], helmet: 0.34 },
  { id: 'hamster', name: 'JellyHamster', emoji: '🐹', fur: '#f2b26b', light: '#fff3e0', ear: 'round', muzzle: 0.8, nose: '#ff7f9c', tail: 'none', extras: ['cheeks', 'buckteeth'] },
  { id: 'wolf', name: 'JellyWolf', emoji: '🐺', fur: '#8d93a8', light: '#eef0f6', ear: 'bigtri', inner: '#eef0f6', muzzle: 1.12, nose: DARK, tail: 'bushy', extras: ['cheekfluff'] },
];

export type Species = string;
/** Picker list (id, name, emoji) for menus and the scoreboard. */
export const SPECIES = ANIMALS.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji, tint: a.fur }));
export const JELLY_COLORS = ['#7b4dff', '#ff4fa3', '#22c4e8', '#3ccf7a', '#ffb020', '#ff5a4f'];

export type CharState = 'idle' | 'aim' | 'windup' | 'release' | 'cheer' | 'flop' | 'sad' | 'sit' | 'strike' | 'dance' | 'scratch';

const TENT_LEN = 0.3; // hip height: the body sits on top of the legs
const LEG_LEN = TENT_LEN;
const BODY_H = 0.36; // torso height (neck sits here, in body space)

/** Flat-shaded low-poly look: unindexed geometry with per-face normals. */
function lp<T extends THREE.BufferGeometry>(g: T): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.computeVertexNormals();
  return n;
}
function flat(color: THREE.ColorRepresentation, hatch = 0.45): THREE.MeshToonMaterial {
  return toon(color, {}, hatch); // geometry is unindexed with face normals, so shading is already flat
}
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
function ico(r: number, detail = 1): THREE.BufferGeometry {
  return lp(new THREE.IcosahedronGeometry(r, detail));
}
function deco(m: THREE.Mesh): THREE.Mesh {
  m.userData.noInk = true;
  m.castShadow = false;
  return m;
}

interface Kit {
  body: THREE.Object3D[];
  head: THREE.Object3D[];
  eyes: THREE.Object3D[];
  ears: THREE.Object3D[];
  armR: THREE.Object3D[];
  armL: THREE.Object3D[];
  tail: THREE.Object3D[];
  lights: THREE.Mesh[];
  shoulderY: number;
  shoulderX: number;
  armLen: number;
  /** the surprise set inside the jelly belly */
  treat: THREE.Group;
}

export function animalSpec(id: string): AnimalSpec {
  return ANIMALS.find((a) => a.id === id) ?? ANIMALS[0];
}


export class JellyFolk {
  readonly root = new THREE.Group();
  readonly handR = new THREE.Group();
  readonly species: Species;
  readonly color: string;
  state: CharState = 'idle';

  private hips = new THREE.Group();
  private body = new THREE.Group();
  private neck = new THREE.Group();
  private shoulderR = new THREE.Group();
  private shoulderL = new THREE.Group();
  private tail = new THREE.Group();
  private legs: THREE.Group[] = [];
  private wob: Wobble = makeWobble();
  private treat = new THREE.Group();
  private treatY = 0.16;
  private eyes: THREE.Object3D[] = [];
  private ears: THREE.Object3D[] = [];

  private time = Math.random() * 10;
  private stateTime = 0;
  private blinkIn = 2 + Math.random() * 3;
  private twitchIn = 3 + Math.random() * 4;

  private sLean = new Spring(0, 90, 11);
  private sTwist = new Spring(0, 80, 10);
  private sSquash = new Spring(1, 230, 6);
  private sLift = new Spring(0, 140, 12);
  private sArmR = new Spring(0.15, 110, 12);
  private sArmL = new Spring(0.15, 110, 12);
  private sSpreadR = new Spring(0.25, 110, 12);
  private sSpreadL = new Spring(0.25, 110, 12);
  private headX = new Spring(0, 140, 6);
  private headZ = new Spring(0, 140, 6);
  private earSpring = new Spring(0, 160, 5);
  private tailSpring = new Spring(0, 60, 4);
  private prevLean = 0;
  private prevTwist = 0;
  private prevLift = 0;
  private spin = 0;
  private sway = 0;


  constructor(species: Species, color: string = JELLY_COLORS[0]) {
    this.species = species;
    this.color = color;
    const kit = buildKit(animalSpec(species), color, this.wob);
    this.treat = kit.treat;
    this.treat.position.y = this.treatY;
    this.treat.scale.setScalar(1.15);

    this.root.add(this.hips);
    this.body.position.y = TENT_LEN;
    this.hips.add(this.body);
    kit.body.forEach((o) => this.body.add(o));
    this.body.add(this.treat);
    this.neck.position.y = BODY_H;
    this.body.add(this.neck);
    kit.head.forEach((o) => this.neck.add(o));
    this.eyes = kit.eyes;
    this.ears = kit.ears;

    for (const [sh, sx, parts] of [[this.shoulderR, 1, kit.armR], [this.shoulderL, -1, kit.armL]] as const) {
      sh.position.set(kit.shoulderX * sx, kit.shoulderY, 0);
      parts.forEach((o) => sh.add(o));
      this.body.add(sh);
    }
    this.handR.position.set(0, -kit.armLen, 0.04);
    this.shoulderR.add(this.handR);

    this.tail.position.set(0, 0.08, -0.19);
    kit.tail.forEach((o) => this.tail.add(o));
    this.body.add(this.tail);

    // two stubby gummy legs with round candy feet
    // two chunky moulded legs with a notch between them; pivot at the hip so they can walk
    const legMat = gummy(color, this.wob, { clear: 0.55, wob: 0.6 });
    const legGeo = gummySlab(roundedRect(0.115, LEG_LEN + 0.06, 0.05, -LEG_LEN), 0.1, 0.04);
    for (const sx of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(sx * 0.07, LEG_LEN + 0.02, 0);
      leg.add(mesh(legGeo, legMat));
      leg.userData.side = sx;
      this.hips.add(leg);
      this.legs.push(leg);
    }
    this.mouldInColour(color, kit.eyes);
  }

  /**
   * One-colour candy: every part becomes a shade of the player's gummy colour (features read as
   * moulded bumps: light parts lighter, dark details deeper). The hidden treat keeps its colours.
   */
  private mouldInColour(color: string, eyes: THREE.Object3D[]): void {
    const base = new THREE.Color(color);
    const shades = {
      base: gummy(base, this.wob, { clear: 0.6 }),
      hi: gummy(base.clone().lerp(new THREE.Color('#ffffff'), 0.42), this.wob, { clear: 0.5, wob: 0.8 }),
      // moulded features: same candy, just a touch deeper, so faces read as raised bumps
      lo: gummy(base.clone().multiplyScalar(0.74), this.wob, { clear: 0.45, wob: 0.6, sugar: 0.4 }),
      eye: gummy(base.clone().multiplyScalar(0.6), this.wob, { clear: 0.35, wob: 0.3, sugar: 0.2 }),
    };
    const eyeSet = new Set(eyes);
    const old = new Set<THREE.Material>();
    const lum = new THREE.Color();
    this.root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.treat) return;
      const mat = o.material as THREE.Material & { color?: THREE.Color };
      if ((mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) return; // eye glints stay white
      let pick: keyof typeof shades = 'base';
      if (eyeSet.has(o)) pick = 'eye';
      else if (mat.color) {
        lum.copy(mat.color);
        const l = 0.2126 * lum.r + 0.7152 * lum.g + 0.0722 * lum.b;
        pick = l > 0.78 ? 'hi' : l < 0.12 ? 'eye' : l < 0.3 ? 'lo' : 'base';
      }
      if (mat !== shades[pick]) old.add(mat);
      o.material = shades[pick];
    });
    for (const m of old) if (!Object.values(shades).includes(m)) m.dispose();
  }

  /** Ground speed (m/s) so the legs can walk; 0 when standing still. */
  setMove(speed: number): void {
    this.move = speed;
  }

  private move = 0;
  private walkPh = 0;
  private jig = 0;


  setState(s: CharState): void {
    if (s === this.state) return;
    this.state = s;
    this.stateTime = 0;
    if (s === 'release') this.kick(-0.25);
    if (s === 'cheer') this.kick(0.3);
    if (s === 'flop') this.kick(-0.45);
  }

  kick(amount: number): void {
    this.sSquash.v += amount * 10;
    this.headX.v += amount * 8;
    this.earSpring.v += amount * 30;
    this.tailSpring.v += amount * 20;
    this.jig = Math.min(0.05, this.jig + Math.abs(amount) * 0.05); // whole-body jelly jiggle
  }

  update(dt: number): void {
    dt = Math.min(dt, 1 / 30);
    this.time += dt;
    this.stateTime += dt;
    const t = this.time;
    const st = this.stateTime;

    let lean = 0, twist = 0, squash = 1 + Math.sin(t * 2.2) * 0.02, lift = Math.sin(t * 1.6) * 0.015;
    let armR = 0.04 + Math.sin(t * 2.2) * 0.04, armL = 0.04 + Math.sin(t * 2.2 + 1) * 0.04;
    let spreadR = 0.05, spreadL = 0.05; // arms rest against the sides, gummy-person style
    let legSplay = 0.3, legWave = 0.1, tailWag = 0.35, tailSpeed = 3;

    switch (this.state) {
      case 'aim':
        lean = 0.12; squash = 0.96; armR = 0.6; armL = 0.4; spreadL = 0.6;
        break;
      case 'windup':
        lean = -0.12; twist = -0.25; squash = 0.9; armR = -2.2; armL = 0.6; spreadL = 0.8; legSplay = 0.45;
        break;
      case 'release':
        lean = 0.42; twist = 0.15; squash = 0.93; armR = 1.7; armL = -0.4; spreadL = 1.0;
        break;
      case 'cheer': {
        const hop = Math.abs(Math.sin(st * 7));
        lift = hop * 0.22;
        squash = 1 + (hop - 0.5) * 0.14;
        armR = 2.8 + Math.sin(st * 14) * 0.3; armL = 2.8 + Math.cos(st * 14) * 0.3;
        spreadR = spreadL = 0.5;
        twist = Math.sin(st * 5) * 0.3;
        legWave = 0.5; legSplay = 0.15 + (1 - hop) * 0.4;
        tailWag = 0.9; tailSpeed = 14;
        break;
      }
      case 'flop': {
        const down = st < 1.6;
        lean = down ? -1.4 : 0;
        armR = armL = down ? 2.4 : 0.15;
        spreadR = spreadL = down ? 1.2 : 0.25;
        legSplay = down ? 0.9 : 0.3;
        tailWag = 0.1;
        if (st > 1.6 && st < 1.62) this.kick(0.35);
        if (st > 2.6) this.setState('idle');
        break;
      }
      case 'sad':
        lean = 0.25; squash = 0.93; armR = armL = -0.05; spreadR = spreadL = 0.08; legSplay = 0.5; legWave = 0.03; tailWag = 0.05; tailSpeed = 1;
        break;
      case 'strike': {
        // big spinning jump, then bouncy landing
        const u = Math.min(1, st / 0.9);
        lift = st < 0.9 ? Math.sin(u * Math.PI) * 0.45 : Math.abs(Math.sin(st * 8)) * 0.12 * Math.max(0, 1 - (st - 0.9) / 1.5);
        squash = st < 0.9 ? 1.12 : 1 + Math.sin(st * 16) * 0.1 * Math.max(0, 1 - (st - 0.9));
        armR = armL = 3.0; spreadR = spreadL = 0.9;
        legSplay = 0.1; legWave = 0.6; tailWag = 1; tailSpeed = 16;
        this.spin = st < 0.9 ? easeInOut(u) * Math.PI * 2 : 0;
        if (st > 0.9 && st < 0.92) this.kick(-0.5);
        break;
      }
      case 'dance': {
        // spare: hip-wiggle dance with alternating arm waves
        const b = Math.sin(st * 9);
        twist = b * 0.45; lift = Math.abs(Math.cos(st * 9)) * 0.08;
        squash = 1 + Math.cos(st * 18) * 0.06;
        armR = 1.6 + b * 1.2; armL = 1.6 - b * 1.2; spreadR = spreadL = 0.8;
        this.sway = b * 0.18; legWave = 0.4; tailWag = 0.8; tailSpeed = 9;
        break;
      }
      case 'scratch': {
        // split: puzzled head-scratch
        armR = 3.25; spreadR = 0.2; armL = 0.2; spreadL = 0.5; // paw beside the helmet, not over the face
        lean = 0.08; squash = 0.97;
        this.headZ.target = 0.35 + Math.sin(st * 12) * 0.04;
        legWave = 0.05;
        break;
      }
      case 'sit':
        squash = 0.97; armR = armL = 0.5; spreadR = spreadL = 0.4; legSplay = 1.2; legWave = 0.15; tailWag = 0.25;
        break;
    }

    this.sLean.target = lean;
    this.sTwist.target = twist;
    this.sSquash.target = squash;
    this.sLift.target = lift;
    this.sArmR.target = armR;
    this.sArmL.target = armL;
    this.sSpreadR.target = spreadR;
    this.sSpreadL.target = spreadL;

    const sq = this.sSquash.update(dt);
    const leanX = this.sLean.update(dt);
    const tw = this.sTwist.update(dt);
    const lf = this.sLift.update(dt);
    this.hips.position.y = Math.max(-0.05, lf);
    this.hips.rotation.x = leanX;
    this.hips.rotation.y = tw + this.spin;
    this.hips.rotation.z = this.sway;
    if (this.state !== 'strike') this.spin = 0;
    if (this.state !== 'dance') this.sway *= 0.9;
    if (this.state !== 'scratch') this.headZ.target = 0;
    this.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));

    // head lags behind body motion (bobblehead jiggle)
    const dLean = (leanX - this.prevLean) / dt;
    const dTwist = (tw - this.prevTwist) / dt;
    const dLift = (lf - this.prevLift) / dt;
    this.prevLean = leanX;
    this.prevTwist = tw;
    this.prevLift = lf;
    this.headX.v -= dLean * 0.06;
    this.headZ.v -= dTwist * 0.04;
    this.sSquash.v -= dLift * 0.03;
    this.earSpring.v -= dLift * 0.5;
    this.neck.rotation.x = this.headX.update(dt) * 0.6 + (this.state === 'sad' ? 0.25 : 0);
    this.neck.rotation.z = this.headZ.update(dt) * 0.5 + Math.sin(t * 1.3) * 0.03;

    this.shoulderR.rotation.x = -this.sArmR.update(dt);
    this.shoulderL.rotation.x = -this.sArmL.update(dt);
    this.shoulderR.rotation.z = this.sSpreadR.update(dt);
    this.shoulderL.rotation.z = -this.sSpreadL.update(dt);

    this.tail.rotation.y = Math.sin(t * tailSpeed) * tailWag + this.tailSpring.update(dt) * 0.3;
    this.tail.rotation.x = -0.4;

    // ears: spring flop + occasional twitch
    this.twitchIn -= dt;
    if (this.twitchIn < 0) {
      this.twitchIn = 2.5 + Math.random() * 4;
      this.earSpring.v += 6;
    }
    const ear = this.earSpring.update(dt);
    // ears only ever perk up (never droop): perk = which way is 'up' for that ear
    const perk = Math.max(-0.05, ear);
    this.ears.forEach((e) => (e.rotation.z = (e.userData.baseZ ?? 0) + perk * 0.18 * (e.userData.perk ?? 1)));

    // legs: waddle-walk with ground speed, splay for poses, tuck forward when sitting
    const walk = Math.min(1, this.move / 3);
    this.walkPh += dt * (6 + this.move * 3.2);
    for (const leg of this.legs) {
      const sx = leg.userData.side as number;
      let swing = Math.sin(this.walkPh + (sx > 0 ? 0 : Math.PI)) * 0.75 * walk + Math.sin(t * 4 + sx) * legWave * 0.15;
      let splay = sx * (legSplay - 0.3) * 0.5;
      if (this.state === 'sit') {
        swing = -1.35;
        splay = sx * 0.12;
      }
      leg.rotation.x += (swing - leg.rotation.x) * Math.min(1, dt * 18);
      leg.rotation.z += (splay - leg.rotation.z) * Math.min(1, dt * 12);
    }
    if (walk > 0.05) this.hips.rotation.z += Math.sin(this.walkPh) * 0.07 * walk; // side-to-side waddle

    // jelly wobble energy: kicks + squash speed, decaying like a settling pudding
    this.jig *= Math.exp(-dt * 3.2);
    this.wob.time.value = t;
    this.wob.amp.value = this.jig + Math.min(0.02, Math.abs(this.sSquash.v) * 0.0015) + walk * 0.004;
    this.treat.rotation.y = t * 0.6;
    this.treat.position.y = this.treatY + Math.sin(t * 1.7) * 0.012;

    this.blinkIn -= dt;
    const blink = this.blinkIn < 0.12 && this.blinkIn > 0 ? 0.12 : 1;
    if (this.blinkIn <= 0) this.blinkIn = 2 + Math.random() * 3.5;
    const sad = this.state === 'sad' || (this.state === 'flop' && st < 1.6);
    for (const e of this.eyes) e.scale.y = (sad ? 0.6 : 1) * blink;
  }

  handWorld(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.handR.getWorldPosition(out);
  }
}


// ---------------------------------------------------------------- gummy body + animal head

/**
 * Moulded gummy slab: a 2D outline extruded with a fat soft bevel, so it has the flat-front,
 * pillowy-edge look of a gummy candy. Low segment counts keep it faceted/low poly.
 * The outline is centred on x, spans y 0..h, and is centred in depth.
 */
function gummySlab(outline: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(outline, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.85,
    bevelSegments: 2,
    curveSegments: 5,
  });
  g.translate(0, 0, -depth / 2);
  return lp(g);
}

function roundedRect(w: number, h: number, r: number, y0 = 0, topW = w): THREE.Shape {
  // trapezoid-ish rounded rectangle: bottom width w, top width topW
  const s = new THREE.Shape();
  const bx = w / 2;
  const tx = topW / 2;
  s.moveTo(-bx + r, y0);
  s.lineTo(bx - r, y0);
  s.quadraticCurveTo(bx, y0, bx, y0 + r);
  s.lineTo(tx, y0 + h - r);
  s.quadraticCurveTo(tx, y0 + h, tx - r, y0 + h);
  s.lineTo(-tx + r, y0 + h);
  s.quadraticCurveTo(-tx, y0 + h, -tx, y0 + h - r);
  s.lineTo(-bx, y0 + r);
  s.quadraticCurveTo(-bx, y0, -bx + r, y0);
  return s;
}

/** Gummy-person torso: chunky slab, slightly narrower at the shoulders, belly bulge in depth. */
function gummyTorso(): THREE.BufferGeometry {
  const g = gummySlab(roundedRect(0.28, BODY_H - 0.04, 0.09, 0, 0.24), 0.12, 0.05);
  // pillowy belly: push the front/back faces out a little in the middle
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const z = p.getZ(i);
    const u = y / BODY_H;
    p.setZ(i, z * (1 + Math.sin(Math.min(1, Math.max(0, u)) * Math.PI) * 0.25));
  }
  g.computeVertexNormals();
  return g;
}

/** Fluted jelly-mould torso: wide at the base, ribbed like a turned-out pudding, low poly. */
export function puddingGeometry(): THREE.BufferGeometry {
  const seg = 16;
  const g = new THREE.CylinderGeometry(0.15, 0.2, BODY_H, seg, 3);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const ang = Math.atan2(z, x);
    const u = (y + BODY_H / 2) / BODY_H; // 0 bottom .. 1 top
    // ribs + a soft belly bulge + rounded shoulders
    const k = (1 + Math.cos(ang * 8) * 0.07) * (1 + Math.sin(u * Math.PI) * 0.12) * (u > 0.85 ? 1 - (u - 0.85) * 1.6 : 1);
    p.setX(i, (x / r) * r * k);
    p.setZ(i, (z / r) * r * k * 0.92);
  }
  g.translate(0, BODY_H / 2, 0);
  return lp(g);
}

function buildKit(a: AnimalSpec, color: string, w: Wobble): Kit {
  const fur = gummy(a.fur, w, { clear: 0.45 });
  const light = gummy(a.light, w, { clear: 0.35, wob: 0.8 });
  const dark = flat(DARK, 0);
  const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });

  const kit: Kit = {
    body: [], head: [], eyes: [], ears: [], armR: [], armL: [], tail: [], lights: [],
    shoulderY: BODY_H - 0.06, shoulderX: 0.175, armLen: 0.19,
    treat: new THREE.Group(),
  };
  const B = kit.body;
  const H = kit.head;

  // ---- gummy body: a fluted jelly-mould torso in the player's colour (like a turned-out pudding)
  const torso = mesh(gummyTorso(), gummy(color, w, { clear: 0.7 }), 0, 0.02, 0);
  // a soft gummy neck so head and body read as one moulded candy (jelly-baby style)
  const neck = mesh(ico(0.13, 1), gummy(color, w, { clear: 0.6 }), 0, BODY_H - 0.02, 0);
  neck.scale.set(1, 0.6, 0.92);
  B.push(torso, neck);

  // the surprise inside: every animal has its own treat set into the jelly
  kit.treat = buildTreat(treatFor(a.id));

  // ---- arms: gummy limbs in the player colour, paws in the animal's colour
  // arms: moulded slab limbs that rest against the body's sides (gummy-person pose)
  const armGeo = gummySlab(roundedRect(0.075, 0.2, 0.037, -0.2), 0.05, 0.03);
  for (const list of [kit.armR, kit.armL]) list.push(mesh(armGeo, gummy(color, w, { clear: 0.55, wob: 0.5 }), 0, 0.01, 0));

  // ---- animal head (gummy, sits in the cream ruff)
  const head = mesh(ico(0.17, 1), fur, 0, 0.15, 0);
  head.scale.set(1.12, 0.98, 1);
  H.push(head);

  // eyes
  let eyeY = 0.19, eyeZ = 0.145, eyeR = 0.04; // big domed gummy eyes
  if (a.extras.includes('frogeyes')) {
    eyeY = 0.29; eyeZ = 0.1; eyeR = 0.034;
    for (const sx of [-1, 1]) H.push(mesh(ico(0.068, 1), fur, sx * 0.085, 0.27, 0.04));
  }
  if (a.extras.includes('owleyes')) {
    eyeR = 0.036;
    for (const sx of [-1, 1]) {
      const ring = mesh(ico(0.07, 1), light, sx * 0.075, 0.19, 0.12);
      ring.scale.set(1, 1, 0.45);
      H.push(ring);
    }
    eyeZ = 0.16;
  }
  for (const sx of [-1, 1]) {
    if (a.extras.includes('eyepatch')) {
      const patch = deco(mesh(ico(0.05, 1), dark, sx * 0.078, 0.18, 0.13));
      patch.scale.set(0.85, 1.15, 0.5);
      patch.rotation.z = sx * 0.5;
      H.push(patch);
    }
    const eye = mesh(ico(eyeR, 1), dark, sx * (a.extras.includes('frogeyes') ? 0.085 : 0.075), eyeY, eyeZ);
    eye.scale.set(1, 1, 0.55); // shallow raised dome, moulded into the face
    const glint = deco(mesh(new THREE.SphereGeometry(eyeR * 0.3, 6, 4), white, eyeR * 0.3, eyeR * 0.4, eyeR * 0.75));
    eye.add(glint);
    H.push(eye);
    kit.eyes.push(eye);
  }

  // muzzle / face patches
  if (a.muzzle > 0) {
    const m = a.muzzle;
    const muzzle = mesh(ico(0.085, 1), a.muzzleColor ? flat(a.muzzleColor, 0.3) : light, 0, 0.1, 0.12 + 0.01 * m);
    muzzle.scale.set(1.2 * m, 0.8 * Math.min(m, 1.15), 0.8 * m);
    H.push(muzzle);
    if (a.nose) H.push(mesh(ico(0.025, 0), flat(a.nose, 0), 0, 0.125, 0.15 + 0.05 * m));
    if (a.muzzleColor) for (const sx of [-1, 1]) H.push(deco(mesh(ico(0.012, 0), dark, sx * 0.035, 0.1, 0.2)));
  }
  const ex = (e: Extra) => a.extras.includes(e);
  if (ex('face')) {
    const f = mesh(ico(0.13, 1), light, 0, 0.14, 0.07);
    f.scale.set(1.15, 1, 0.65);
    H.push(f);
    if (a.nose) H.push(mesh(ico(0.018, 0), flat(a.nose, 0), 0, 0.13, 0.155));
  }
  if (ex('faceMask')) {
    const f = mesh(ico(0.14, 1), light, 0, 0.13, 0.06);
    f.scale.set(1.15, 0.95, 0.7);
    H.push(f);
  }
  if (ex('mask')) {
    const m = deco(mesh(ico(0.06, 1), dark, 0, 0.185, 0.12));
    m.scale.set(2.3, 0.6, 0.6);
    H.push(m);
  }
  if (ex('patch')) {
    const p = deco(mesh(ico(0.05, 1), flat(a.earColor ?? a.fur), 0.08, 0.2, 0.125));
    p.scale.set(1, 0.9, 0.35);
    H.push(p);
  }
  if (ex('tongue')) {
    const t = deco(mesh(ico(0.025, 1), flat('#ff6f91', 0), 0.01, 0.05, 0.19));
    t.scale.set(1, 1.3, 0.5);
    H.push(t);
  }
  if (ex('smile')) {
    const s = deco(mesh(new THREE.TorusGeometry(0.07, 0.008, 5, 16, Math.PI), dark, 0, 0.13, 0.155));
    s.rotation.z = Math.PI;
    H.push(s);
  }
  if (ex('snout')) {
    const s = mesh(lp(new THREE.CylinderGeometry(0.055, 0.06, 0.05, 8)), flat('#ff9fbb'), 0, 0.11, 0.17);
    s.rotation.x = Math.PI / 2;
    H.push(s);
    for (const sx of [-1, 1]) H.push(deco(mesh(ico(0.012, 0), dark, sx * 0.02, 0.11, 0.196)));
  }
  if (ex('bignose')) {
    const n = mesh(ico(0.045, 1), dark, 0, 0.13, 0.17);
    n.scale.set(0.9, 1.3, 0.8);
    H.push(n);
  }
  if (ex('beak')) {
    const b = mesh(lp(new THREE.ConeGeometry(0.03, 0.07, 4)), flat('#ffa62b'), 0, 0.12, 0.19);
    b.rotation.x = Math.PI / 2;
    H.push(b);
  }
  if (ex('bill')) {
    const b = mesh(ico(0.06, 1), flat('#ffa62b'), 0, 0.1, 0.18);
    b.scale.set(1.3, 0.4, 1);
    H.push(b);
  }
  if (ex('cheeks')) for (const sx of [-1, 1]) {
    const c = mesh(ico(0.055, 1), a.id === 'hamster' ? light : flat('#ff9fbb', 0.2), sx * 0.12, 0.1, 0.1);
    c.scale.set(1, 0.85, 0.7);
    H.push(c);
  }
  if (ex('buckteeth')) H.push(deco(mesh(lp(new THREE.BoxGeometry(0.035, 0.03, 0.01)), white, 0, 0.055, 0.19)));
  if (ex('whiskers')) for (const sx of [-1, 1]) for (const dy of [0, -0.02]) {
    const w = deco(mesh(lp(new THREE.BoxGeometry(0.08, 0.005, 0.005)), dark, sx * 0.13, 0.11 + dy, 0.15));
    w.rotation.z = sx * (dy ? -0.15 : 0.1);
    H.push(w);
  }
  if (ex('freckles')) for (const sx of [-1, 1]) for (let i = 0; i < 2; i++) H.push(deco(mesh(ico(0.009, 0), flat(a.id === 'frog' ? '#3c9a3c' : '#ffffff', 0), sx * (0.1 + i * 0.025), 0.13 - i * 0.012, 0.135)));
  if (ex('foreheadStripes') || ex('stripes')) {
    const col = ex('stripes') ? dark : flat(a.accent ?? DARK, 0);
    const stripe = (x: number, y: number, z: number, rz = 0, len = 0.06) => {
      const s = deco(mesh(lp(new THREE.BoxGeometry(0.016, len, 0.02)), col, x, y, z));
      s.rotation.z = rz;
      return s;
    };
    H.push(stripe(0, 0.29, 0.09), stripe(-0.04, 0.28, 0.1, 0.3), stripe(0.04, 0.28, 0.1, -0.3));
    if (ex('stripes')) for (const sx of [-1, 1]) {
      const s1 = stripe(sx * 0.16, 0.17, 0.07, sx * 1.2, 0.07);
      s1.rotation.y = sx * 0.9;
      H.push(s1);
    }
  }
  if (ex('cheekfluff')) for (const sx of [-1, 1]) {
    const c = mesh(lp(new THREE.ConeGeometry(0.04, 0.08, 4)), light, sx * 0.17, 0.09, 0.06);
    c.rotation.z = sx * -1.9;
    H.push(c);
  }
  if (ex('mane')) {
    const maneMat = flat(a.accent ?? '#c8642a');
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2;
      const t = mesh(ico(0.062, 0), maneMat, Math.cos(ang) * 0.17, 0.15 + Math.sin(ang) * 0.16, -0.04);
      t.scale.set(1, 1, 0.7);
      H.push(t);
    }
  }
  if (ex('rainbowMane')) {
    const cols = ['#ff5fa2', '#ffb020', '#ffe14d', '#3ccf7a', '#22c4e8', '#7b4dff'];
    cols.forEach((c, i) => H.push(mesh(ico(0.045, 0), flat(c, 0.2), 0, 0.31 - i * 0.045, -0.06 - i * 0.025)));
  }
  if (ex('horn')) {
    const h = mesh(lp(new THREE.ConeGeometry(0.028, 0.15, 6)), flat('#ffd23f', 0.2), 0, 0.37, 0.07);
    h.rotation.x = 0.35;
    H.push(h);
  }
  if (ex('horns')) for (const sx of [-1, 1]) {
    const h = mesh(lp(new THREE.ConeGeometry(0.022, 0.07, 5)), flat('#fff1cf', 0.2), sx * 0.11, 0.31, 0.0);
    h.rotation.z = -sx * 0.6;
    H.push(h);
  }
  if (ex('antlers')) for (const sx of [-1, 1]) {
    const brown = flat('#8a5a3c');
    const main = mesh(lp(new THREE.CylinderGeometry(0.012, 0.016, 0.14, 5)), brown, sx * 0.08, 0.36, 0);
    main.rotation.z = -sx * 0.4;
    const branch = mesh(lp(new THREE.CylinderGeometry(0.01, 0.012, 0.07, 5)), brown, sx * 0.13, 0.4, 0.01);
    branch.rotation.z = sx * 0.6;
    H.push(main, branch);
  }
  if (ex('wool')) {
    for (let i = 0; i < 9; i++) {
      const ang = (i / 9) * Math.PI + 0.1;
      H.push(mesh(ico(0.06, 0), flat('#ffffff', 0.3), Math.cos(ang) * 0.15, 0.2 + Math.sin(ang) * 0.13, -0.03 + (i % 2) * 0.04));
    }
  }
  if (ex('crest')) for (let i = -1; i <= 1; i++) {
    const c = mesh(lp(new THREE.ConeGeometry(0.018, 0.06, 4)), fur, i * 0.025, 0.33, 0.02);
    c.rotation.z = -i * 0.4;
    H.push(c);
  }
  if (ex('spots')) {
    const spot = flat(a.accent ?? DARK, 0);
    const s1 = deco(mesh(ico(0.05, 1), spot, -0.1, 0.23, 0.09));
    s1.scale.set(1, 0.8, 0.4);
    H.push(s1);
  }

  // ---- ears
  const earMat = flat(a.earColor ?? a.fur);
  const innerMat = flat(a.inner ?? PINK, 0);
  const ear = (sx: number, x: number, y: number, z: number, baseZ: number, parts: THREE.Object3D[]) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * x, y, z);
    pivot.userData.baseZ = baseZ;
    pivot.userData.perk = a.ear === 'floppy' ? -sx : sx;
    pivot.rotation.z = baseZ;
    parts.forEach((p) => pivot.add(p));
    H.push(pivot);
    kit.ears.push(pivot);
  };
  for (const sx of [-1, 1]) {
    switch (a.ear) {
      case 'tri':
      case 'bigtri': {
        const big = a.ear === 'bigtri';
        const outer = mesh(lp(new THREE.ConeGeometry(big ? 0.068 : 0.055, big ? 0.13 : 0.1, 4)), earMat, 0, big ? 0.05 : 0.04, 0);
        const inner = deco(mesh(lp(new THREE.ConeGeometry(big ? 0.038 : 0.03, big ? 0.08 : 0.06, 3)), innerMat, 0, big ? 0.04 : 0.03, 0.022));
        ear(sx, big ? 0.12 : 0.11, 0.27, -0.01, -sx * 0.28, [outer, inner]);
        break;
      }
      case 'round':
      case 'biground': {
        const big = a.ear === 'biground';
        const outer = mesh(ico(big ? 0.075 : 0.045, big ? 1 : 0), earMat, 0, 0.02, 0);
        if (big) outer.scale.set(1, 1, 0.5);
        const inner = deco(mesh(ico(big ? 0.045 : 0.025, 0), innerMat, 0, 0.02, big ? 0.03 : 0.025));
        ear(sx, big ? 0.16 : 0.12, big ? 0.26 : 0.27, -0.02, -sx * 0.3, [outer, inner]);
        break;
      }
      case 'floppy': {
        const e = mesh(ico(0.07, 1), earMat, 0, -0.08, 0);
        e.scale.set(0.55, 1.3, 0.35);
        ear(sx, 0.15, 0.24, 0, sx * 0.35, [e]);
        break;
      }
      case 'long': {
        const e = mesh(lp(new THREE.CapsuleGeometry(0.035, 0.15, 2, 6)), earMat, 0, 0.11, 0);
        e.scale.z = 0.6;
        const inner = deco(mesh(lp(new THREE.CapsuleGeometry(0.018, 0.11, 2, 5)), innerMat, 0, 0.11, 0.02));
        ear(sx, 0.06, 0.29, -0.01, -sx * 0.14, [e, inner]);
        break;
      }
      case 'side': {
        const e = mesh(ico(0.05, 1), earMat, sx * 0.04, 0, 0);
        e.scale.set(1.5, 0.55, 0.7);
        ear(sx, 0.18, 0.21, -0.01, sx * 0.25, [e]);
        break;
      }
      case 'tufts': {
        const e = mesh(lp(new THREE.ConeGeometry(0.03, 0.08, 4)), earMat, 0, 0.04, 0);
        ear(sx, 0.12, 0.28, 0, -sx * 0.6, [e]);
        break;
      }
      case 'none':
        break;
    }
  }

  // ---- tail (pokes out the back of the suit)
  const tailMat = a.tailColor ? flat(a.tailColor) : fur;
  const T = kit.tail;
  switch (a.tail) {
    case 'curl':
    case 'short': {
      const segs = a.tail === 'short' ? 2 : 4;
      for (let i = 0; i < segs; i++) {
        const s = mesh(ico(0.045 - i * 0.006, 0), tailMat, 0, 0.06 * i, -0.04 * i);
        if (ex('ringtail') && i % 2 === 1) s.material = dark;
        T.push(s);
      }
      break;
    }
    case 'tuft':
      for (let i = 0; i < 3; i++) T.push(mesh(ico(0.025, 0), tailMat, 0, 0.05 * i, -0.04 * i));
      T.push(mesh(ico(0.05, 0), flat(a.accent ?? a.fur), 0, 0.15, -0.12));
      break;
    case 'bushy': {
      const b = mesh(ico(0.08, 1), tailMat, 0, 0.09, -0.06);
      b.scale.set(0.8, 1.5, 0.8);
      T.push(b);
      if (ex('ringtail')) for (let i = 0; i < 2; i++) {
        const r = mesh(lp(new THREE.TorusGeometry(0.06, 0.015, 4, 10)), dark, 0, 0.06 + i * 0.07, -0.06);
        r.rotation.x = Math.PI / 2;
        T.push(r);
      } else T.push(mesh(ico(0.045, 0), light, 0, 0.2, -0.08));
      break;
    }
    case 'puff':
      T.push(mesh(ico(0.06, 1), light, 0, 0.02, -0.02));
      break;
    case 'curly': {
      const c = mesh(new THREE.TorusGeometry(0.035, 0.011, 6, 14, Math.PI * 1.7), fur, 0, 0.04, -0.03);
      c.rotation.y = Math.PI / 2;
      T.push(c);
      break;
    }
    case 'thin': {
      const t = mesh(lp(new THREE.CylinderGeometry(0.006, 0.012, 0.24, 5)), flat(PINK), 0, 0.1, -0.06);
      t.rotation.x = -0.6;
      T.push(t);
      break;
    }
    case 'feather':
      for (let i = -1; i <= 1; i++) {
        const f = mesh(lp(new THREE.ConeGeometry(0.03, 0.08, 4)), fur, i * 0.035, 0.02, -0.02);
        f.rotation.set(-1.9, 0, i * 0.4);
        T.push(f);
      }
      break;
    case 'none':
      break;
  }
  return kit;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
