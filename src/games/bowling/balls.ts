import * as THREE from 'three';
import { jelly, toon } from '../../core/toon.ts';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { recolorTexture, type FittedModel } from '../../core/assets.ts';

/** keatura's ball model (centred on its origin), when loaded. */
let ballModel: FittedModel | null = null;
export function useBallModel(m: FittedModel | null): void {
  ballModel = m;
}
import { BALL_R, DECK_END_Z, LIFT, PIT_FLOOR_Y } from './world.ts';

/** A ball's look: a random candy swirl of 2-3 colours. Generated fresh every game. */
export interface BallSkin {
  id: number;
  colors: string[];
  material: THREE.MeshToonMaterial;
}

const CANDY = ['#ff5fa2', '#ffd23f', '#3fd6ff', '#8be36b', '#b78cff', '#ff8b4d', '#ff3b6b', '#5ef2c2', '#fff06a', '#6a7bff'];

function swirlTexture(colors: string[], seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = colors[0];
  g.fillRect(0, 0, 128, 64);
  const rnd = mulberry(seed);
  const style = Math.floor(rnd() * 3);
  for (let k = 1; k < colors.length; k++) {
    g.fillStyle = colors[k];
    if (style === 0) {
      // marbled bands
      for (let x = 0; x < 128; x += 2) {
        const y = 32 + Math.sin(x / 9 + k * 2 + rnd()) * 14 * k - 10 + k * 10;
        g.fillRect(x, y, 2, 8 + k * 2);
      }
    } else if (style === 1) {
      // polka dots
      for (let i = 0; i < 14; i++) g.fillRect(Math.floor(rnd() * 120), Math.floor(rnd() * 58), 8, 6);
    } else {
      // diagonal stripes
      for (let i = -64; i < 128; i += 22) {
        for (let y = 0; y < 64; y += 2) g.fillRect(i + y * 0.6 + k * 7, y, 6, 2);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; // crisp, pixel-art read
  t.minFilter = THREE.NearestMipmapLinearFilter;
  return t;
}

export function randomSkins(n: number, seed = (Math.random() * 1e9) | 0): BallSkin[] {
  const rnd = mulberry(seed);
  const out: BallSkin[] = [];
  for (let i = 0; i < n; i++) {
    const pool = [...CANDY];
    const count = 2 + Math.floor(rnd() * 2);
    const colors: string[] = [];
    for (let k = 0; k < count; k++) colors.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    // With the pixel-art model: keep its pattern, swap its palette. Otherwise: procedural swirl.
    const ramp = [new THREE.Color(colors[0]).multiplyScalar(0.35).getStyle(), ...colors, '#fffaf2'];
    const map = (ballModel?.map && recolorTexture(ballModel.map, ramp)) || swirlTexture(colors, seed + i * 77);
    out.push({ id: i, colors, material: toon('#ffffff', { map }, 0.4) });
  }
  return out;
}

/** Ball visual: sphere + finger holes. The sphere material is swapped per skin. */
export function makeBallMesh(skin: BallSkin): THREE.Group {
  const g = new THREE.Group();
  const geo = ballModel ? ballModel.geometry : new THREE.SphereGeometry(BALL_R, 24, 16);
  const ball = new THREE.Mesh(geo, skin.material);
  ball.castShadow = true;
  ball.name = 'ballSphere';
  g.add(ball);
  if (ballModel) return g; // the model's texture already has finger holes
  const holeMat = new THREE.MeshBasicMaterial({ color: '#1a0f33' });
  for (const [a, b] of [[0, 0.3], [-0.25, -0.05], [0.25, -0.05]] as const) {
    const h = new THREE.Mesh(new THREE.CircleGeometry(0.013, 10), holeMat);
    const dir = new THREE.Vector3(a, b + 0.2, 1).normalize();
    h.position.copy(dir).multiplyScalar(BALL_R + 0.001);
    h.lookAt(dir.multiplyScalar(2));
    h.userData.noInk = true;
    g.add(h);
  }
  return g;
}

export function setBallSkin(ball: THREE.Group, skin: BallSkin): void {
  const s = ball.getObjectByName('ballSphere') as THREE.Mesh;
  s.material = skin.material;
  ball.userData.skin = skin;
}

// ---- Ball return: lift machine + glass tube + return console --------------------------------
/** Console beside the approach, where balls queue on a rack for the bowler. */
export const CONSOLE = { x: -1.25, z: 1.0, len: 1.3, w: 0.5, h: 0.42 };
const TUBE_X = -1.3;
const TUBE_Y = 0.45;
const RACK_Y = CONSOLE.h + 0.02 + BALL_R; // ball centre height on the rack
const HOOD_Z = CONSOLE.z - CONSOLE.len / 2 + 0.17;
const RACK_FRONT_Z = CONSOLE.z + CONSOLE.len / 2 - 0.1;
const SLOT_GAP = BALL_R * 2 + 0.015;
const LIFT_FOOT_Y = PIT_FLOOR_Y + BALL_R - 0.06;

type Stage = 'queued' | 'route' | 'pop' | 'roll' | 'held';

interface RideBall {
  skin: BallSkin;
  mesh: THREE.Group;
  stage: Stage;
  route: THREE.CurvePath<THREE.Vector3> | null;
  dist: number;
  legs: [number, number];
  t: number;
  /** current rack z (rolling toward its slot) */
  z: number;
}

interface Puff {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

const glass = () => jelly('#c8f6ff', { opacity: 0.22, glow: 0.05, rim: '#ffffff' });

/**
 * The ball machine: the pit conveyor rolls each ball to the Jelly Lift, a glass column with a
 * spinning screw that carries it up; it whooshes down a glass tube along the lane into the
 * return console, pops up through the glass hood in a puff of air, and rolls down the rack to
 * queue behind the others. Picking a ball makes the rest roll forward to close the gap.
 */
export class BallHub {
  readonly group = new THREE.Group();
  private balls: RideBall[] = [];
  /** order of balls on the rack, front first */
  private queue: RideBall[] = [];
  private tubePath = new THREE.CurvePath<THREE.Vector3>();
  private screw!: THREE.Mesh;
  private cog!: THREE.Group;
  private liftLamp!: THREE.Mesh;
  private hood!: THREE.Group;
  private hoodLamp!: THREE.Mesh;
  private fan!: THREE.Group;
  private puffs: Puff[] = [];
  private puffGeo = new THREE.IcosahedronGeometry(0.035, 0);
  private puffMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false });
  private liftBusy = 0;
  private hoodKick = 0;
  private time = 0;

  constructor(scene: THREE.Scene, skins: BallSkin[]) {
    scene.add(this.group);
    this.buildConsole();
    this.buildLift();

    // glass return tube: lift top -> along the lane -> dips into the back of the console
    const top = new THREE.Vector3(LIFT.x, LIFT.top, LIFT.z);
    const runStart = new THREE.Vector3(TUBE_X, TUBE_Y, LIFT.z + 1.0);
    const runEnd = new THREE.Vector3(TUBE_X, TUBE_Y, CONSOLE.z - CONSOLE.len / 2 - 0.9);
    const intake = new THREE.Vector3(CONSOLE.x, 0.24, CONSOLE.z - CONSOLE.len / 2 - 0.02);
    this.tubePath.add(new THREE.CubicBezierCurve3(top, top.clone().add(new THREE.Vector3(0, 0.35, 0.1)), new THREE.Vector3(TUBE_X, TUBE_Y + 0.15, LIFT.z + 0.6), runStart));
    this.tubePath.add(new THREE.LineCurve3(runStart, runEnd));
    this.tubePath.add(new THREE.CubicBezierCurve3(runEnd, new THREE.Vector3(TUBE_X, TUBE_Y, runEnd.z + 0.45), new THREE.Vector3(CONSOLE.x, 0.24, intake.z - 0.35), intake));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(this.tubePath as unknown as THREE.Curve<THREE.Vector3>, 360, BALL_R + 0.025, 14, false), glass());
    tube.renderOrder = 4;
    tube.userData.noInk = true; // glass: a back-face outline would show through it
    this.add(tube, false);
    // candy support posts + clamps under the straight run
    const postMat = [toon('#3fd6ff'), toon('#ff5fa2'), toon('#ffd23f')];
    for (let z = runStart.z + 0.6, i = 0; z < runEnd.z; z += 2.2, i++) {
      const h = TUBE_Y + 0.7 - BALL_R;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, h, 8), postMat[i % 3]);
      post.position.set(TUBE_X, TUBE_Y - BALL_R - h / 2, z);
      const clamp = new THREE.Mesh(new THREE.TorusGeometry(BALL_R + 0.035, 0.018, 8, 20), postMat[(i + 1) % 3]);
      clamp.position.set(TUBE_X, TUBE_Y, z);
      this.add(post);
      this.add(clamp);
    }

    skins.forEach((skin) => {
      const mesh = makeBallMesh(skin);
      this.group.add(mesh);
      const b: RideBall = { skin, mesh, stage: 'queued', route: null, dist: 0, legs: [0, 0], t: 0, z: RACK_FRONT_Z };
      this.balls.push(b);
      this.queue.push(b);
    });
    this.queue.forEach((b, i) => {
      b.z = this.slotZ(i);
      b.mesh.position.set(CONSOLE.x, RACK_Y, b.z);
    });
  }

  private add(m: THREE.Mesh, shadow = true): void {
    m.castShadow = shadow;
    m.receiveShadow = true;
    this.group.add(m);
  }

  private slotZ(i: number): number {
    return RACK_FRONT_Z - i * SLOT_GAP;
  }

  /** Return console: rounded body, twin-rail rack, glass hood with lamp, intake funnel, fan. */
  private buildConsole(): void {
    const { x, z, len, w, h } = CONSOLE;
    const body = new THREE.Mesh(new RoundedBoxGeometry(w, h, len, 4, 0.09), toon('#7b4dff', {}, 0.35));
    body.position.set(x, h / 2, z);
    this.add(body);
    const band = new THREE.Mesh(new RoundedBoxGeometry(w + 0.02, 0.07, len + 0.02, 2, 0.03), toon('#ffd23f', {}, 0.2));
    band.position.set(x, h * 0.62, z);
    this.add(band, false);
    // rack rails: the balls ride on these
    const railMat = toon('#ff5fa2', {}, 0.2);
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, len - 0.2, 4, 8), railMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(x + sx * 0.07, h + 0.02, z + 0.05);
      this.add(rail);
    }
    // front bumper the queue rests against
    const bump = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 8, 16, Math.PI), toon('#3fd6ff'));
    bump.position.set(x, h + 0.02, z + len / 2 - 0.02);
    this.add(bump);
    // intake funnel on the back where the tube plugs in
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(BALL_R + 0.05, BALL_R + 0.09, 0.08, 16, 1, true), toon('#3fd6ff'));
    funnel.rotation.x = Math.PI / 2;
    funnel.position.set(x, 0.24, z - len / 2 - 0.01);
    this.add(funnel);

    // glass hood where balls pop up
    this.hood = new THREE.Group();
    this.hood.position.set(x, h, HOOD_Z);
    this.group.add(this.hood);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass());
    dome.renderOrder = 4;
    dome.userData.noInk = true; // glass: a back-face outline would show through it
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 24), toon('#ffd23f'));
    rim.rotation.x = Math.PI / 2;
    this.hoodLamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: '#8be36b' }));
    this.hoodLamp.position.y = 0.19;
    this.hood.add(dome, rim, this.hoodLamp);

    // pinwheel fan on the side: spins faster when a ball arrives
    this.fan = new THREE.Group();
    this.fan.position.set(x - w / 2 - 0.02, h * 0.55, z + 0.25);
    this.fan.rotation.y = -Math.PI / 2;
    const bladeCols = ['#ff5fa2', '#ffd23f', '#3fd6ff', '#8be36b'];
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.CircleGeometry(0.08, 3), toon(bladeCols[i], { side: THREE.DoubleSide }, 0));
      blade.rotation.z = (i / 4) * Math.PI * 2;
      blade.position.set(Math.cos(blade.rotation.z) * 0.05, Math.sin(blade.rotation.z) * 0.05, 0);
      blade.userData.noInk = true;
      this.fan.add(blade);
    }
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), toon('#ffffff'));
    this.fan.add(hub);
    this.group.add(this.fan);
  }

  /** The Jelly Lift: housing at pit level, glass column with a turning screw, cog and lamp on top. */
  private buildLift(): void {
    const bodyMat = toon('#b78cff', {}, 0.4);
    const trim = toon('#ffd23f', {}, 0.3);
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.5, 0.46, 3, 0.08), bodyMat);
    housing.position.set(LIFT.x, -0.45, LIFT.z);
    this.add(housing);
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(BALL_R + 0.04, 0.03, 8, 18, Math.PI), trim);
    mouth.position.set(LIFT.x + 0.23, LIFT_FOOT_Y + 0.02, LIFT.z);
    mouth.rotation.y = Math.PI / 2;
    this.add(mouth);

    const colH = LIFT.top + 0.15 - (-0.2);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(BALL_R + 0.05, BALL_R + 0.05, colH, 20, 1, true), glass());
    column.position.set(LIFT.x, -0.2 + colH / 2, LIFT.z);
    column.renderOrder = 4;
    column.userData.noInk = true; // glass: a back-face outline would show through it
    this.add(column, false);

    const turns = 6;
    const helixPts: THREE.Vector3[] = [];
    for (let i = 0; i <= turns * 16; i++) {
      const t = i / (turns * 16);
      const a = t * turns * Math.PI * 2;
      helixPts.push(new THREE.Vector3(Math.cos(a) * (BALL_R + 0.02), t * colH, Math.sin(a) * (BALL_R + 0.02)));
    }
    this.screw = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helixPts), 240, 0.012, 6, false), toon('#ff5fa2', {}, 0));
    this.screw.position.set(LIFT.x, -0.2, LIFT.z);
    this.screw.userData.noInk = true;
    this.add(this.screw, false);

    const cap = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.22, 0.42, 3, 0.07), bodyMat);
    cap.position.set(LIFT.x, LIFT.top + 0.2, LIFT.z);
    this.add(cap);
    this.liftLamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), new THREE.MeshBasicMaterial({ color: '#8be36b' }));
    this.liftLamp.position.set(LIFT.x, LIFT.top + 0.36, LIFT.z);
    this.add(this.liftLamp, false);

    this.cog = new THREE.Group();
    this.cog.position.set(LIFT.x - 0.23, LIFT.top + 0.2, LIFT.z);
    this.cog.rotation.y = Math.PI / 2;
    this.cog.add(new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 8, 20), trim));
    for (let i = 0; i < 8; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.04), trim);
      const a = (i / 8) * Math.PI * 2;
      tooth.position.set(Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0);
      tooth.rotation.z = a;
      this.cog.add(tooth);
    }
    this.group.add(this.cog);
  }

  /** Take a random queued ball off the rack. Returns its skin and where it was sitting. */
  pick(): { skin: BallSkin; from: THREE.Vector3 } | null {
    if (this.queue.length === 0) return null;
    const i = Math.floor(Math.random() * this.queue.length);
    const b = this.queue.splice(i, 1)[0];
    b.stage = 'held';
    b.mesh.visible = false;
    return { skin: b.skin, from: b.mesh.position.clone() };
  }

  /** Send a thrown ball back through the machine, starting from where it stopped. */
  sendBack(skin: BallSkin, from: THREE.Vector3): void {
    const b = this.balls.find((x) => x.skin === skin);
    if (!b) return;
    const start = from.clone();
    // balls that stopped on the lane / in a gutter get "swept" into the pit first
    if (start.y > PIT_FLOOR_Y + BALL_R + 0.05 || start.z > DECK_END_Z) start.set(THREE.MathUtils.clamp(start.x, -0.8, 0.8), PIT_FLOOR_Y + BALL_R, DECK_END_Z - 0.3);
    const foot = new THREE.Vector3(LIFT.x, LIFT_FOOT_Y, LIFT.z);
    const top = new THREE.Vector3(LIFT.x, LIFT.top, LIFT.z);
    const route = new THREE.CurvePath<THREE.Vector3>();
    const roll = new THREE.LineCurve3(start, foot);
    const climb = new THREE.LineCurve3(foot, top);
    route.add(roll);
    route.add(climb);
    for (const c of this.tubePath.curves) route.add(c);
    b.route = route;
    b.dist = 0;
    b.legs = [roll.getLength(), climb.getLength()];
    b.stage = 'route';
    b.mesh.visible = true;
    b.mesh.position.copy(start);
  }

  /** Balls riding the machine (not on the rack, not in hand). */
  get travelling(): number {
    return this.balls.filter((b) => b.stage === 'route' || b.stage === 'pop' || b.stage === 'roll').length;
  }

  get seated(): number {
    return this.queue.length;
  }

  private spawnPuffs(): void {
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(this.puffGeo, this.puffMat);
      m.position.set(CONSOLE.x, CONSOLE.h + 0.12, HOOD_Z);
      const a = (i / 9) * Math.PI * 2;
      this.puffs.push({ mesh: m, vel: new THREE.Vector3(Math.cos(a) * 0.6, 0.5 + Math.random() * 0.5, Math.sin(a) * 0.6), life: 0.6 });
      this.group.add(m);
    }
  }

  update(dt: number): void {
    this.time += dt;
    let lifting = false;
    let arriving = 0;

    for (const b of this.balls) {
      switch (b.stage) {
        case 'route': {
          const [a, l] = b.legs;
          // conveyor roll, slow screw climb, then a fast whoosh down the tube
          const speed = b.dist < a ? 1.4 : b.dist < a + l ? 0.9 : 7.5;
          if (b.dist >= a && b.dist < a + l) lifting = true;
          b.dist += speed * dt;
          const len = b.route!.getLength();
          if (b.dist >= len) {
            b.route = null;
            b.stage = 'pop';
            b.t = 0;
            this.spawnPuffs();
            this.hoodKick = 1;
            break;
          }
          b.route!.getPointAt(b.dist / len, b.mesh.position);
          b.mesh.rotation.x -= (dt * speed) / BALL_R * 0.5;
          break;
        }
        case 'pop': {
          // pops up through the hood with a little bounce
          b.t += dt;
          const u = Math.min(1, b.t / 0.45);
          const bounce = Math.sin(u * Math.PI) * 0.16 * (1 - u * 0.4);
          b.mesh.position.set(CONSOLE.x, THREE.MathUtils.lerp(RACK_Y - 0.2, RACK_Y, Math.min(1, u * 1.6)) + bounce, HOOD_Z);
          arriving++;
          if (u >= 1) {
            b.stage = 'roll';
            b.z = HOOD_Z;
            this.queue.push(b);
          }
          break;
        }
      }
    }

    // rack: every queued / rolling ball eases toward its slot (rolling as it goes)
    this.queue.forEach((b, i) => {
      const target = this.slotZ(i);
      const dz = target - b.z;
      if (Math.abs(dz) > 0.002) {
        const step = Math.sign(dz) * Math.min(Math.abs(dz), 1.1 * dt);
        b.z += step;
        b.mesh.rotation.x += step / BALL_R;
        b.mesh.position.set(CONSOLE.x, RACK_Y, b.z);
        arriving++;
      } else {
        if (b.stage === 'roll') {
          b.stage = 'queued';
          b.mesh.rotation.x = 0;
        }
        b.mesh.position.set(CONSOLE.x, RACK_Y + (b.stage === 'queued' ? Math.max(0, Math.sin(this.time * 3 + i)) * 0.004 : 0), target);
      }
    });

    // puffs drift up and fade
    for (const p of this.puffs) {
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - 3 * dt);
      p.mesh.scale.setScalar(1 + (0.6 - p.life) * 3);
    }
    const dead = this.puffs.filter((p) => p.life <= 0);
    dead.forEach((p) => this.group.remove(p.mesh));
    this.puffs = this.puffs.filter((p) => p.life > 0);
    this.puffMat.opacity = 0.85;

    // machine animation
    this.liftBusy = THREE.MathUtils.damp(this.liftBusy, lifting ? 1 : 0.15, 6, dt);
    this.screw.rotation.y += dt * 9 * this.liftBusy;
    this.cog.rotation.z += dt * 5 * this.liftBusy;
    (this.liftLamp.material as THREE.MeshBasicMaterial).color.set(lifting ? '#ff5fa2' : '#8be36b');
    this.hoodKick = Math.max(0, this.hoodKick - dt * 2.5);
    const wob = Math.sin(this.time * 30) * this.hoodKick;
    this.hood.scale.set(1 + wob * 0.08, 1 - wob * 0.12 + this.hoodKick * 0.1, 1 + wob * 0.08);
    (this.hoodLamp.material as THREE.MeshBasicMaterial).color.set(this.hoodKick > 0.05 || arriving ? '#ff5fa2' : '#8be36b');
    this.fan.rotation.z -= dt * (1.5 + (arriving ? 14 : 0) + this.hoodKick * 20);
  }
}


function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
