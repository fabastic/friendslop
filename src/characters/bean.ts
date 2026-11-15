import * as THREE from 'three';
import { jelly, toon } from '../core/toon.ts';
import { Spring, Tentacle } from './rig.ts';

/**
 * Original "Jellybean" party character, jellyfish edition.
 * A translucent dome bell with a scalloped rim, glowing core, freckles and a painted face,
 * standing on short skinned tentacles, with two long skinned tentacle arms.
 * Rigged: the bell is a SkinnedMesh on a 3-bone spine whose upper bones are spring-driven
 * (jiggle), and every tentacle is a SkinnedMesh on a bone chain with follow-through springs.
 */

export const BEAN_COLORS = ['#ff6fae', '#5fd0ff', '#ffcf3f', '#8be36b', '#b78cff', '#ff8b4d'];

export type BeanState = 'idle' | 'aim' | 'windup' | 'release' | 'cheer' | 'flop' | 'sad';

// ---- bell geometry ----------------------------------------------------------------------
const RIM_Y = 0.34;
const TOP_Y = 1.0;
const BELL_R = 0.36;
const SCALLOPS = 9;

/** Outer dome radius at height y (bean space). */
function bellR(y: number): number {
  const t = THREE.MathUtils.clamp((y - RIM_Y) / (TOP_Y - RIM_Y), 0, 1);
  // round-shouldered dome, slightly pinched above the rim
  return BELL_R * Math.pow(Math.max(0, 1 - t * t), 0.42) * (1 - 0.06 * Math.exp(-((t - 0.06) ** 2) / 0.004));
}

function bellGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  // underside (slightly concave), from the centre out to the rim lip
  for (let i = 0; i <= 6; i++) {
    const r = (i / 6) * (BELL_R * 0.98);
    pts.push(new THREE.Vector2(Math.max(r, 0.0001), RIM_Y + 0.05 - (i / 6) ** 2 * 0.06));
  }
  // rim lip then up the dome
  for (let i = 0; i <= 30; i++) {
    const y = RIM_Y + (i / 30) * (TOP_Y - RIM_Y);
    pts.push(new THREE.Vector2(Math.max(bellR(y), 0.0001), y));
  }
  const geo = new THREE.LatheGeometry(pts, 54);
  // scallop the rim: push vertices near the lip out/down in a wave around the circumference
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.2) continue;
    const near = Math.max(0, 1 - Math.abs(y - RIM_Y) / 0.09);
    if (near <= 0) continue;
    const a = Math.atan2(z, x);
    const wave = Math.cos(a * SCALLOPS);
    const k = 1 + 0.07 * wave * near;
    pos.setXYZ(i, x * k, y - 0.035 * (0.5 + 0.5 * wave) * near, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Seat an object on the bell surface at (x, y), facing outward. */
function seat(o: THREE.Object3D, x: number, y: number, lift: number, boneY: number): void {
  const r = bellR(y);
  const z = Math.sqrt(Math.max(0, r * r - x * x));
  const a = Math.atan2(x, z);
  o.position.set(Math.sin(a) * (r + lift), y - boneY, Math.cos(a) * (r + lift));
  // tilt to follow the dome curvature
  const dy = 0.01;
  const slope = (bellR(y + dy) - bellR(y - dy)) / (2 * dy);
  o.rotation.set(Math.atan(slope) * 0.9, a, 0, 'YXZ');
}

export interface BeanOptions {
  color?: string;
}

export class Bean {
  readonly root = new THREE.Group();
  /** Attach held items here (tip of the right tentacle arm). */
  readonly handR = new THREE.Group();
  state: BeanState = 'idle';

  private hips = new THREE.Group();
  private spine: THREE.Bone[] = [];
  private bell: THREE.SkinnedMesh;
  private core: THREE.Mesh;
  private legs: Tentacle[] = [];
  private armR: Tentacle;
  private armL: Tentacle;
  private shoulderR = new THREE.Group();
  private shoulderL = new THREE.Group();
  private eyes: THREE.Group[] = [];
  private mouth: THREE.Mesh;
  private mouthSad: THREE.Mesh;
  private tendril: Tentacle;

  private time = Math.random() * 10;
  private stateTime = 0;
  private blinkIn = 2 + Math.random() * 3;

  private sLean = new Spring(0, 90, 11);
  private sTwist = new Spring(0, 80, 10);
  private sSquash = new Spring(1, 230, 6); // under-damped -> jelly jiggle
  private sLift = new Spring(0, 140, 12);
  private sArmR = new Spring(0.2, 110, 12);
  private sArmL = new Spring(0.2, 110, 12);
  private sSpreadR = new Spring(0.5, 110, 12);
  private sSpreadL = new Spring(0.5, 110, 12);
  private jx1 = new Spring(0, 160, 5);
  private jz1 = new Spring(0, 160, 5);
  private jx2 = new Spring(0, 120, 4);
  private jz2 = new Spring(0, 120, 4);
  private prevLean = 0;
  private prevTwist = 0;
  private prevLift = 0;
  private prevArmR = 0.2;

  constructor(opts: BeanOptions = {}) {
    const color = new THREE.Color(opts.color ?? BEAN_COLORS[Math.floor(Math.random() * BEAN_COLORS.length)]);
    const deep = color.clone().offsetHSL(0.02, 0.05, -0.12);
    const light = color.clone().lerp(new THREE.Color('#ffffff'), 0.6);
    const bellMat = jelly(color, { opacity: 0.8 });
    const limbMat = toon(deep, {}, 0.5);
    const dark = toon('#2a1b4a', {}, 0);
    const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const blush = toon('#ff7f9c', {}, 0);
    const freckle = toon(light, {}, 0);
    const coreMat = new THREE.MeshBasicMaterial({ color: light.clone().lerp(new THREE.Color('#fff6b0'), 0.4) });

    this.root.add(this.hips);

    // Spine: base -> mid -> top. Upper bones jiggle.
    const yb = [RIM_Y - 0.04, 0.62, 0.86];
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Bone();
      b.position.y = i === 0 ? yb[0] : yb[i] - yb[i - 1];
      if (i > 0) this.spine[i - 1].add(b);
      this.spine.push(b);
    }
    const geo = bellGeometry();
    const pos = geo.attributes.position;
    const si = new Uint16Array(pos.count * 4);
    const sw = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      let a: number, b: number, f: number;
      if (y < yb[1]) {
        a = 0; b = 1; f = THREE.MathUtils.smoothstep(y, yb[0] + 0.02, yb[1]);
      } else {
        a = 1; b = 2; f = THREE.MathUtils.smoothstep(y, yb[1], yb[2] + 0.05);
      }
      si.set([a, b, 0, 0], i * 4);
      sw.set([1 - f, f, 0, 0], i * 4);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    this.bell = new THREE.SkinnedMesh(geo, bellMat);
    this.bell.add(this.spine[0]);
    this.bell.bind(new THREE.Skeleton(this.spine));
    this.bell.castShadow = true;
    this.bell.frustumCulled = false;
    this.bell.renderOrder = 3;
    this.hips.add(this.bell);

    // Glowing core, seen through the jelly
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), coreMat);
    this.core.position.y = 0.6 - yb[0] - (yb[1] - yb[0]) + 0.0;
    this.core.position.set(0, -0.02, -0.05);
    this.core.userData.noInk = true;
    this.spine[1].add(this.core);

    // Face (seated on the dome, rides the mid bone)
    const faceBone = this.spine[1];
    const faceY = yb[1];
    for (const sx of [-1, 1]) {
      const eye = new THREE.Group();
      seat(eye, 0.1 * sx, 0.67, 0.006, faceY);
      const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.068, 22, 16), white);
      sclera.scale.set(0.82, 1.12, 0.4);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 18, 14), dark);
      pupil.scale.set(0.8, 1.1, 0.4);
      pupil.position.set(0.004 * sx, -0.008, 0.016);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), white);
      shine.position.set(0.015 * sx, 0.024, 0.036);
      const shine2 = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), white);
      shine2.position.set(-0.012 * sx, -0.022, 0.036);
      for (const p of [pupil, shine, shine2]) p.userData.noInk = true;
      eye.add(sclera, pupil, shine, shine2);
      faceBone.add(eye);
      this.eyes.push(eye);

      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), blush);
      cheek.scale.set(1.35, 0.7, 0.3);
      cheek.userData.noInk = true;
      seat(cheek, 0.175 * sx, 0.585, 0.002, faceY);
      faceBone.add(cheek);
    }
    // open "D" smile: half disc with a tongue
    const smileGeo = new THREE.CircleGeometry(0.042, 20, Math.PI, Math.PI);
    this.mouth = new THREE.Mesh(smileGeo, dark);
    seat(this.mouth, 0, 0.585, 0.007, faceY);
    const tongue = new THREE.Mesh(new THREE.CircleGeometry(0.022, 14, Math.PI, Math.PI), toon('#ff5f86', {}, 0));
    tongue.position.set(0, -0.022, 0.001);
    tongue.userData.noInk = true;
    this.mouth.add(tongue);
    faceBone.add(this.mouth);
    this.mouthSad = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 16, Math.PI), dark);
    seat(this.mouthSad, 0, 0.57, 0.007, faceY);
    this.mouthSad.visible = false;
    faceBone.add(this.mouthSad);

    // Freckle spots on the crown
    const rng = (s: number) => (Math.sin(s * 91.7) * 43758.5453) % 1;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const y = 0.8 + Math.abs(rng(i + 1)) * 0.1;
      const r = bellR(y);
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.026 + Math.abs(rng(i + 9)) * 0.016, 12, 8), freckle);
      s.scale.z = 0.3;
      s.userData.noInk = true;
      const d = new THREE.Group();
      d.rotation.y = a + Math.PI; // keep them off the face
      s.position.set(0, y - yb[2], r + 0.002);
      s.rotation.x = -0.6;
      d.add(s);
      this.spine[2].add(d);
    }

    // Curly tendril on top
    this.tendril = new Tentacle(0.16, 0.018, 0.008, 4, limbMat);
    this.tendril.mesh.rotation.x = Math.PI; // point up
    this.tendril.mesh.position.y = TOP_Y - yb[2] - 0.01;
    const tipBall = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), coreMat);
    this.tendril.tip.add(tipBall);
    this.spine[2].add(this.tendril.mesh);

    // Tentacle legs around the underside
    const nLegs = 6;
    for (let i = 0; i < nLegs; i++) {
      const a = (i / nLegs) * Math.PI * 2 + Math.PI / nLegs;
      const t = new Tentacle(RIM_Y + 0.02, 0.05, 0.022, 4, limbMat);
      t.mesh.position.set(Math.sin(a) * 0.17, RIM_Y + 0.02, Math.cos(a) * 0.17);
      t.mesh.rotation.y = a;
      this.hips.add(t.mesh);
      this.legs.push(t);
    }

    // Tentacle arms
    for (const [sh, sx] of [[this.shoulderR, 1], [this.shoulderL, -1]] as const) {
      sh.position.set(0.3 * sx, 0.5, 0.02);
      this.hips.add(sh);
    }
    this.armR = new Tentacle(0.36, 0.045, 0.026, 5, limbMat);
    this.armL = new Tentacle(0.36, 0.045, 0.026, 5, limbMat);
    this.shoulderR.add(this.armR.mesh);
    this.shoulderL.add(this.armL.mesh);
    for (const arm of [this.armR, this.armL]) {
      const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), limbMat);
      mitt.scale.set(1, 0.8, 1.1);
      arm.tip.add(mitt);
    }
    this.handR.position.set(0, -0.06, 0.02);
    this.armR.tip.add(this.handR);
  }

  setState(s: BeanState): void {
    if (s === this.state) return;
    this.state = s;
    this.stateTime = 0;
    if (s === 'release') this.kick(-0.25);
    if (s === 'cheer') this.kick(0.3);
    if (s === 'flop') this.kick(-0.45);
  }

  /** Jelly impulse: positive stretches, negative squashes. */
  kick(amount: number): void {
    this.sSquash.v += amount * 10;
    this.jx2.v += amount * 6;
    this.tendril.whip(amount * 30, amount * 12);
    for (const l of this.legs) l.whip(amount * 10, 0);
  }

  update(dt: number): void {
    dt = Math.min(dt, 1 / 30);
    this.time += dt;
    this.stateTime += dt;
    const t = this.time;
    const st = this.stateTime;

    let lean = 0, twist = 0, squash = 1 + Math.sin(t * 2.2) * 0.025, lift = 0;
    let armR = 0.2 + Math.sin(t * 2.2) * 0.08, armL = 0.2 + Math.sin(t * 2.2 + 1) * 0.08;
    let spreadR = 0.5, spreadL = 0.5;
    let sad = false;
    let legSplay = 0.25;
    let legWave = 0.08;

    switch (this.state) {
      case 'aim':
        lean = 0.12; squash = 0.95; armR = 0.6; armL = 0.4; spreadL = 0.8;
        break;
      case 'windup':
        lean = -0.12; twist = -0.25; squash = 0.88; armR = -2.2; armL = 0.6; spreadL = 0.9; spreadR = 0.25; legSplay = 0.4;
        break;
      case 'release':
        lean = 0.42; twist = 0.15; squash = 0.92; armR = 1.7; armL = -0.4; spreadL = 1.1; spreadR = 0.2;
        break;
      case 'cheer': {
        const hop = Math.abs(Math.sin(st * 7));
        lift = hop * 0.22;
        squash = 1 + (hop - 0.5) * 0.16;
        armR = 2.8 + Math.sin(st * 14) * 0.3; armL = 2.8 + Math.cos(st * 14) * 0.3;
        spreadR = spreadL = 0.7;
        twist = Math.sin(st * 5) * 0.3;
        legWave = 0.5;
        legSplay = 0.15 + (1 - hop) * 0.4;
        break;
      }
      case 'flop': {
        const down = st < 1.6;
        lean = down ? -1.4 : 0;
        lift = down ? -0.04 : 0;
        armR = armL = down ? 2.4 : 0.2;
        spreadR = spreadL = down ? 1.3 : 0.5;
        legSplay = down ? 0.9 : 0.25;
        legWave = down ? 0.35 : 0.08;
        sad = down;
        if (st > 1.6 && st < 1.62) this.kick(0.35);
        if (st > 2.6) this.setState('idle');
        break;
      }
      case 'sad':
        lean = 0.25; squash = 0.92; armR = armL = -0.05; spreadR = spreadL = 0.15; sad = true; legSplay = 0.5; legWave = 0.03;
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
    this.hips.rotation.y = tw;

    // jiggle bones: upper bell lags behind body motion
    const dLean = (leanX - this.prevLean) / dt;
    const dTwist = (tw - this.prevTwist) / dt;
    const dLift = (lf - this.prevLift) / dt;
    this.prevLean = leanX;
    this.prevTwist = tw;
    this.prevLift = lf;
    this.jx1.v -= dLean * 0.9 * dt * 60 * 0.05;
    this.jx2.v -= dLean * 1.6 * dt * 60 * 0.05;
    this.jz1.v -= dTwist * 0.6 * dt * 60 * 0.05;
    this.jz2.v -= dTwist * 1.1 * dt * 60 * 0.05;
    this.sSquash.v -= dLift * 0.5 * dt * 60 * 0.05;
    const [b0, b1, b2] = this.spine;
    b0.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    b1.rotation.set(this.jx1.update(dt) * 0.5, 0, this.jz1.update(dt) * 0.3);
    b2.rotation.set(this.jx2.update(dt) * 0.6, 0, this.jz2.update(dt) * 0.4);

    // inner core pulse
    const pulse = 1 + Math.sin(t * 3.1) * 0.06;
    this.core.scale.setScalar(pulse);

    // arms: shoulder swing + curling follow-through down the tentacle
    const aR = this.sArmR.update(dt);
    const aL = this.sArmL.update(dt);
    const dArm = (aR - this.prevArmR) / dt;
    this.prevArmR = aR;
    this.armR.whip(dArm * 0.02, 0);
    this.shoulderR.rotation.x = -aR;
    this.shoulderL.rotation.x = -aL;
    this.shoulderR.rotation.z = this.sSpreadR.update(dt);
    this.shoulderL.rotation.z = -this.sSpreadL.update(dt);
    const holding = this.state === 'aim' || this.state === 'windup' || this.state === 'idle';
    this.armR.pose(dt,
      (i) => (holding ? -0.12 : Math.sin(t * 3 - i * 0.8) * 0.12) - 0.05 * i,
      (i) => Math.sin(t * 2.3 - i * 0.7) * 0.05);
    this.armL.pose(dt,
      (i) => Math.sin(t * 3.2 - i * 0.8 + 1) * 0.15 - 0.06 * i,
      (i) => Math.sin(t * 2.1 - i * 0.7) * 0.06);

    // legs: splayed outward, gentle undulation, curl at the tips
    for (const leg of this.legs) {
      leg.pose(dt,
        (i) => (i === 1 ? legSplay : 0) + Math.sin(t * 4 + leg.phase - i * 0.9) * legWave + (i === leg.bones.length - 1 ? 0.6 : 0),
        (i) => Math.sin(t * 2.7 + leg.phase - i) * legWave * 0.5);
    }
    this.tendril.pose(dt,
      (i) => 0.35 + Math.sin(t * 2 - i) * 0.15,
      (i) => Math.sin(t * 1.6 - i * 0.6) * 0.2);

    this.mouth.visible = !sad;
    this.mouthSad.visible = sad;

    // blink
    this.blinkIn -= dt;
    const blink = this.blinkIn < 0.12 && this.blinkIn > 0 ? 0.1 : 1;
    if (this.blinkIn <= 0) this.blinkIn = 2 + Math.random() * 3.5;
    for (const e of this.eyes) e.scale.y = sad ? 0.75 * blink : blink;
  }

  /** World position of the right hand. */
  handWorld(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.handR.getWorldPosition(out);
  }
}
