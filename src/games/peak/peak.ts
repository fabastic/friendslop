/**
 * Jelly Peak — co-op climb. Hop up a spiral of candy slabs, cling to the pillar while your
 * stamina lasts, grab berries to refill, and give teammates a leg-up. First to the flag wins
 * bragging rights; everyone who makes it gets a spot on the summit board.
 */
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { GameContext, Minigame } from '../../core/minigame.ts';
import { disposeObject } from '../../core/engine.ts';
import { addInkOutlines } from '../../core/ink.ts';
import { JellyFolk, JELLY_COLORS, SPECIES, type Species, type CharState } from '../../characters/jellyfolk.ts';
import { Confetti } from '../bowling/confetti.ts';
import type { NetMsg } from '../../net/protocol.ts';
import type { SessionEvent } from '../../net/session.ts';
import { buildMountain, type Mountain, type Checkpoint } from './mountain.ts';
import { buildScenery } from '../bowling/world.ts';
import { TouchControls } from './touch.ts';
import './peak.css';

const CHAR_SCALE = 0.8;
const CAP_HALF = 0.25;
const CAP_R = 0.22;
const GRAVITY = 20;
const WALK = 4.2;
const JUMP_V = 7.8;
const CLIMB_V = 2.4;
const STAMINA_MAX = 100;
const CLIMB_DRAIN = 11;
const WALLJUMP_COST = 18;
const SPLAT_DROP = 11;
const INK = { width: 2.2, skip: (m: THREE.Mesh) => !!m.userData.noInk };

interface Climber {
  pid: string;
  name: string;
  species: string;
  color: string;
  char: JellyFolk;
  /** remote: latest network target */
  target?: { x: number; y: number; z: number; ry: number; s: string };
  best: number;
  doneTime: number | null;
  label: HTMLElement;
}

export const PEAK_INFO = { id: 'peak', title: 'Jelly Peak' };

export class Peak implements Minigame {
  readonly id = 'peak';
  readonly title = 'Jelly Peak';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
  debug: Record<string, unknown> = {};

  private ctx!: GameContext;
  private R!: typeof RAPIER;
  private world!: RAPIER.World;
  private mountain!: Mountain;
  private body!: RAPIER.RigidBody;
  private collider!: RAPIER.Collider;
  private kcc!: RAPIER.KinematicCharacterController;
  private confetti!: Confetti;
  private sun!: THREE.DirectionalLight;
  private unsub: (() => void)[] = [];

  private me!: Climber;
  private others: Climber[] = [];
  private online = false;

  // physics state (feet position)
  private pos = new THREE.Vector3();
  private prevPos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private grounded = false;
  private climbing = false;
  private wallN = new THREE.Vector3();
  private wallTime = 0;
  private stamina = STAMINA_MAX;
  private facing = 0;
  private airTop = 0;
  private checkpoint!: Checkpoint;
  private yaw = 0;
  private pitch = 0.32;
  private camDist = 6;
  private dragLast: { x: number; y: number } | null = null;
  private time = 0;
  private started = false;
  private finished = false;
  private paused = false;
  private sendT = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private jumpHeld = false;
  private simT = 0;
  private camReach = 6;
  private camLift = 0;
  private launched = false;
  private scenery!: { update(dt: number): void };
  private boostQueued = false;
  /** direction the climber faces/walks; the camera rides behind it */
  private heading = Math.PI;
  /** temporary look-around from dragging; springs back behind the climber */
  private lookYaw = 0;

  // hud
  private hudRoot!: HTMLElement;
  private stamFill!: HTMLElement;
  private heightEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private teamEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private boardEl: HTMLElement | null = null;
  private pauseEl: HTMLElement | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.R = ctx.R;
    const R = this.R;
    this.world = new R.World({ x: 0, y: 0, z: 0 });

    // sky + light
    this.scene.background = new THREE.Color('#bfe9ff');
    this.scene.fog = new THREE.Fog('#d9f2ff', 40, 140);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#ffd6ec', 1.6));
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -12;
    sc.right = sc.top = 12;
    sc.far = 60;
    this.scene.add(this.sun, this.sun.target);

    this.mountain = buildMountain(R, this.world, this.scene, takePeakSeed());
    // the first game's candy shapes, balloons and clouds, kept clear of the mountain
    this.scenery = buildScenery(this.scene, (x, z, r) => Math.hypot(x, z) < this.mountain.clearR + 4 + r);
    this.checkpoint = this.mountain.checkpoints[0];
    this.confetti = new Confetti(this.scene);

    // line-up: the party (online) or just me (local profile from the hub)
    const net = ctx.net;
    this.online = net.active && net.players.length > 0;
    const prof = readProfile();
    const lineup = this.online
      ? net.players.map((p) => ({ pid: p.peerId, name: p.name, species: p.species, color: p.color }))
      : [{ pid: 'me', name: prof.name, species: prof.species, color: prof.color }];
    const myPid = this.online ? net.myPeerId : 'me';

    this.buildHud();
    lineup.forEach((p, i) => {
      const c = this.makeClimber(p);
      const a = (i - (lineup.length - 1) / 2) * 0.7;
      const start = this.checkpoint.pos.clone().add(new THREE.Vector3(a, 0, 0.6));
      c.char.root.position.copy(start);
      if (p.pid === myPid) {
        this.me = c;
        this.pos.copy(start);
        this.prevPos.copy(start);
      } else this.others.push(c);
    });
    this.me.label.classList.add('me');

    // my capsule
    this.body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y + CAP_HALF + CAP_R, this.pos.z));
    this.collider = this.world.createCollider(R.ColliderDesc.capsule(CAP_HALF, CAP_R), this.body);
    this.kcc = this.world.createCharacterController(0.03);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.kcc.enableAutostep(0.3, 0.15, false);
    this.kcc.enableSnapToGround(0.2);
    this.kcc.setApplyImpulsesToDynamicBodies(false);
    this.world.step();

    addInkOutlines(this.scene, INK);
    this.heading = Math.atan2(-this.checkpoint.pos.x, -this.checkpoint.pos.z); // face the first spire
    this.facing = this.heading;
    this.yaw = this.heading + Math.PI;
    this.bindInput();
    if (this.online) {
      this.unsub.push(net.on((ev) => this.onNet(ev)));
      const hb = window.setInterval(() => this.sendState(), 1000);
      this.unsub.push(() => window.clearInterval(hb));
    }
    const touch = new TouchControls(this.hudRoot, ctx.input);
    this.unsub.push(() => touch.dispose());
    this.countdown();
    this.exposeDebug();
  }

  /** Little candy-dust puff where we land hard. */
  private dust(at: THREE.Vector3, power: number): void {
    const n = Math.round(6 + power * 8);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.dustGeo, this.dustMat);
      const a = (i / n) * Math.PI * 2;
      m.position.set(at.x + Math.cos(a) * 0.15, at.y + 0.05, at.z + Math.sin(a) * 0.15);
      m.userData.v = new THREE.Vector3(Math.cos(a) * (1 + power * 2), 0.8 + Math.random(), Math.sin(a) * (1 + power * 2));
      m.userData.life = 0.6;
      this.scene.add(m);
      this.puffs.push(m);
    }
  }

  private dustGeo = new THREE.IcosahedronGeometry(0.06, 0);
  private dustMat = new THREE.MeshBasicMaterial({ color: '#fff3e6', transparent: true, opacity: 0.9 });
  private puffs: THREE.Mesh[] = [];

  private updateDust(dt: number): void {
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const m = this.puffs[i];
      const v = m.userData.v as THREE.Vector3;
      m.userData.life -= dt;
      v.multiplyScalar(1 - dt * 4);
      m.position.addScaledVector(v, dt);
      m.scale.setScalar(Math.max(0.01, m.userData.life / 0.6) * 1.4);
      if (m.userData.life <= 0) {
        this.scene.remove(m);
        this.puffs.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------- setup
  private makeClimber(p: { pid: string; name: string; species: string; color: string }): Climber {
    const species = (SPECIES.some((s) => s.id === p.species) ? p.species : 'cat') as Species;
    const char = new JellyFolk(species, p.color || JELLY_COLORS[0]);
    char.root.scale.setScalar(CHAR_SCALE);
    addInkOutlines(char.root, INK);
    this.scene.add(char.root);
    const label = this.ctx.hud.el('div', 'pk-name', this.hudRoot);
    label.textContent = p.name;
    label.style.setProperty('--pc', p.color);
    return { ...p, char, best: 0, doneTime: null, label };
  }

  private countdown(): void {
    this.hint('Reach the flag! W/S walk · A/D steer · SPACE jump (hold = higher) · SHIFT on a wall to climb · pink domes bounce · hoops refill · E boost a buddy', 10);
    let n = 3;
    const tick = () => {
      if (n > 0) {
        this.ctx.hud.banner(String(n), 700, '#ffffff');
        this.ctx.sfx.tone(440, 0.12, 'triangle', 0.25);
        n--;
        window.setTimeout(tick, 800);
      } else {
        this.ctx.hud.banner('CLIMB!', 1100, '#ffd23f');
        this.ctx.sfx.tone(880, 0.25, 'triangle', 0.3);
        this.started = true;
      }
    };
    window.setTimeout(tick, 500);
  }

  private bindInput(): void {
    const { input } = this.ctx;
    this.unsub.push(
      input.onDrag((s) => {
        if (s.length === 0) {
          this.dragLast = null;
          return;
        }
        const p = s[s.length - 1];
        if (this.dragLast) {
          this.lookYaw = clamp(this.lookYaw - (p.x - this.dragLast.x) * 0.006, -2.6, 2.6);
          this.pitch = clamp(this.pitch + (p.y - this.dragLast.y) * 0.004, 0.08, 1.1);
        }
        this.dragLast = { x: p.x, y: p.y };
      }),
    );
    const wheel = (e: WheelEvent) => {
      this.camDist = clamp(this.camDist + Math.sign(e.deltaY) * 0.6, 3, 11);
    };
    window.addEventListener('wheel', wheel, { passive: true });
    this.unsub.push(() => window.removeEventListener('wheel', wheel));
  }

  // ---------------------------------------------------------------- simulation
  fixedUpdate(dt: number): void {
    if (this.paused && !this.online) return;
    if (this.started && !this.finished) this.time += dt;
    this.prevPos.copy(this.pos);
    this.stepMe(dt);
    this.checkPickups(dt);
    if (this.online) {
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = 0.1;
        this.sendState();
      }
    }
  }

  private stepMe(dt: number): void {
    const k = this.ctx.input.keys;
    const input = this.ctx.input;
    const canMove = this.started && !this.paused;
    void input;
    // heading-relative controls (camera rides behind): A/D steer, W/S forward/back
    let fIn = 0;
    let rIn = 0;
    if (canMove) {
      fIn = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      rIn = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    }
    if (!this.climbing) {
      // turn faster when standing still, smoother at a run
      const turnRate = fIn !== 0 ? 2.6 : 3.4;
      this.heading -= rIn * turnRate * dt;
    }
    const back = fIn < 0 ? 0.55 : 1; // backing up is slower
    let ix = Math.sin(this.heading) * fIn * back;
    let iz = Math.cos(this.heading) * fIn * back;
    // strafing nudge so A/D alone still shuffles a little sideways while turning
    if (fIn === 0 && rIn !== 0 && !this.climbing) {
      ix = -Math.cos(this.heading) * rIn * 0.25;
      iz = Math.sin(this.heading) * rIn * 0.25;
    }
    this.jumpBuffer -= dt;
    this.jumpHeld = canMove && k.has('Space');
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    const wantsClimb = canMove && (k.has('ShiftLeft') || k.has('ShiftRight'));

    // climbing: on a wall, holding shift, with stamina left
    const onWall = this.wallTime > 0;
    this.wallTime -= dt;
    // any forward push into a wall counts (glancing approaches used to skate past)
    const pushing = -(ix * this.wallN.x + iz * this.wallN.z) > 0.05 || fIn > 0;
    // grab from the air, or step onto the wall from the ground by pushing into it
    this.climbing = onWall && wantsClimb && this.stamina > 0 && (!this.grounded || pushing || this.climbing);
    if (this.climbing) {
      const into = -(ix * this.wallN.x + iz * this.wallN.z); // pushing toward the wall = up
      const up = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) || (into > 0.3 ? 1 : 0);
      this.vel.set(-this.wallN.x * 0.6, up * CLIMB_V, -this.wallN.z * 0.6);
      // sideways shuffle along the wall
      const sx = -this.wallN.z;
      const sz = this.wallN.x;
      const side = -rIn; // facing the wall, D shuffles right
      this.vel.x += sx * side * 1.6;
      this.vel.z += sz * side * 1.6;
      this.stamina = Math.max(0, this.stamina - CLIMB_DRAIN * dt * (up !== 0 ? 1 : 0.45));
      // grabbing a hold gives back a little grip — climb hold to hold
      const hands = this.tmpV.copy(this.pos).setY(this.pos.y + 0.75);
      for (const h of this.mountain.holds) {
        if (h.cooldown > 0 || hands.distanceTo(h.pos) > 0.6) continue;
        h.cooldown = 2;
        this.stamina = Math.min(STAMINA_MAX, this.stamina + 9);
        this.me.char.kick(0.15);
        this.ctx.sfx.plink(2 + Math.floor(Math.random() * 3));
        break;
      }
      if (this.jumpBuffer > 0 && this.stamina >= WALLJUMP_COST * 0.5) {
        this.jumpBuffer = 0;
        this.stamina = Math.max(0, this.stamina - WALLJUMP_COST);
        if (fIn < 0) {
          // S + jump: kick off the wall, up and away (to reach the next spire)
          this.vel.set(this.wallN.x * 4.2, JUMP_V * 0.9, this.wallN.z * 4.2);
          this.wallTime = 0;
        } else {
          // dyno: lunge straight up the face to the next hold, staying on the wall
          this.vel.set(-this.wallN.x * 0.8, 6.8, -this.wallN.z * 0.8);
          this.launched = true;
        }
        this.climbing = false;
        this.me.char.kick(0.5);
        this.ctx.sfx.boing();
      }
      this.facing = Math.atan2(-this.wallN.x, -this.wallN.z);
    } else {
      // walking / air control
      const accel = this.grounded ? 30 : 9;
      this.vel.x += (ix * WALK - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (iz * WALK - this.vel.z) * Math.min(1, accel * dt);
      // variable jump: let go early for a short hop; falls are snappier than rises
      if (this.vel.y <= 0) this.launched = false;
      const g = this.vel.y > 0 ? (this.jumpHeld || this.launched ? GRAVITY : GRAVITY * 2.3) : GRAVITY * 1.3;
      this.vel.y = Math.max(-28, this.vel.y - g * dt);
      if (this.grounded && this.vel.y < 0) this.vel.y = -1;
      if (this.jumpBuffer > 0 && this.coyote > 0) {
        this.jumpBuffer = 0;
        this.coyote = 0;
        this.vel.y = JUMP_V;
        this.me.char.kick(0.45);
        this.ctx.sfx.tone(330, 0.1, 'sine', 0.2, 620);
      }
      this.facing = this.heading;
      if (this.grounded) this.stamina = Math.min(STAMINA_MAX, this.stamina + 34 * dt);
    }

    // cloud rafts swing first; anyone standing on one rides along
    this.simT += dt;
    this.mountain.stepMovers(this.simT);
    const want = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    if (this.grounded) {
      for (const m of this.mountain.movers) {
        const top = m.y + m.half.y;
        if (Math.abs(this.pos.y - top) < 0.25 && Math.hypot(this.pos.x - m.pos.x, this.pos.z - m.pos.z) < 1.15) {
          want.x += m.delta.x;
          want.z += m.delta.z;
          break;
        }
      }
    }
    this.kcc.computeColliderMovement(this.collider, want);
    const mv = this.kcc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
      const c = this.kcc.computedCollision(i);
      const n = c?.normal1;
      if (!n) continue;
      if (Math.abs(n.y) < 0.35) {
        this.wallN.set(n.x, 0, n.z).normalize();
        this.wallTime = 0.12;
      } else if (n.y < -0.5 && this.vel.y > 0) this.vel.y = 0; // bonk head
    }
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(next);
    this.world.step();
    this.pos.set(next.x, next.y - CAP_HALF - CAP_R, next.z);

    // landing: track fall height for the splat rule
    if (!this.grounded && !this.climbing) this.airTop = Math.max(this.airTop, this.pos.y);
    else {
      if (!wasGrounded && this.grounded) {
        const drop = this.airTop - this.pos.y;
        if (drop > SPLAT_DROP) this.splat();
        else if (drop > 0.4) {
          // gummy landing: squash, ripple, snap back
          this.me.char.impact(Math.min(1.2, 0.25 + drop * 0.18));
          if (drop > 1.2) {
            this.me.char.kick(Math.min(0.8, drop * 0.15));
            this.ctx.sfx.tone(200, 0.08, 'sine', 0.2);
            this.dust(this.pos, Math.min(1, drop / 6));
          }
        }
      }
      this.airTop = this.pos.y;
    }
    if (this.pos.y < -10) this.splat();

    // jelly trampolines
    if (this.grounded && this.vel.y <= 0.5) {
      for (const p of this.mountain.pads) {
        if (Math.abs(this.pos.y - p.pos.y) < 0.45 && Math.hypot(this.pos.x - p.pos.x, this.pos.z - p.pos.z) < p.r) {
          this.vel.y = this.jumpHeld ? 15 : 13;
          this.launched = true; // full-height fling even without holding jump
          this.grounded = false;
          this.airTop = this.pos.y;
          p.squish = 1;
          this.me.char.impact(1);
          this.me.char.kick(0.6);
          this.ctx.sfx.boing();
          this.ctx.sfx.tone(260, 0.25, 'sine', 0.25, 780);
          break;
        }
      }
    }
    // candy hoops
    const chest = this.tmpV.copy(this.pos).setY(this.pos.y + 0.45);
    for (const r of this.mountain.rings) {
      if (r.cooldown > 0 || chest.distanceTo(r.pos) > 0.85) continue;
      r.cooldown = 3;
      this.stamina = STAMINA_MAX;
      this.vel.y = Math.max(this.vel.y, 6.5);
      this.launched = true;
      this.airTop = this.pos.y;
      this.flashStamina();
      this.ctx.hud.banner('Hoop! +💪', 900, '#7fe0ff');
      this.ctx.sfx.plink(6);
      this.confetti.burst(r.pos.clone(), 40);
    }

    // progress, checkpoints, summit
    const h = Math.max(0, this.pos.y);
    this.me.best = Math.max(this.me.best, h);
    for (const cp of this.mountain.checkpoints) {
      if (cp.index > this.checkpoint.index && this.grounded && this.pos.distanceTo(cp.pos) < 1.4) {
        this.checkpoint = cp;
        this.ctx.hud.banner(`Rest stop ${cp.index} ✓`, 1200, '#7fe0ff');
        this.ctx.sfx.fanfare();
        this.stamina = STAMINA_MAX;
      }
    }
    if (!this.finished && this.grounded && this.pos.y > this.mountain.summit.y - 0.6) this.reachSummit();

    // state for animation/network
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.4;
    const falling = !this.grounded && this.vel.y < -6;
    const st: CharState = this.finished ? 'dance'
      : this.climbing ? 'climb'
      : !this.grounded ? (this.vel.y > 0.5 ? 'jump' : falling ? 'fall' : 'jump')
      : moving ? 'walk' : 'idle';
    if (this.me.char.state !== st && !(this.me.char.state === 'release' && st === 'idle')) this.me.char.setState(st);
  }

  private splat(): void {
    this.ctx.hud.banner('SPLAT! 🫠', 1300, '#b9a3ff');
    this.ctx.sfx.sad();
    const p = this.checkpoint.pos;
    this.pos.copy(p).add(new THREE.Vector3(0, 0.2, 0));
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.body.setTranslation({ x: p.x, y: p.y + 0.2 + CAP_HALF + CAP_R, z: p.z }, true);
    this.airTop = this.pos.y;
    this.stamina = STAMINA_MAX;
    this.me.char.kick(0.8);
  }

  private checkPickups(dt: number): void {
    void dt;
    const chest = this.pos.clone().add(new THREE.Vector3(0, 0.45, 0));
    for (const b of this.mountain.berries) {
      if (b.taken || chest.distanceTo(b.pos) > 0.7) continue;
      b.taken = true;
      b.respawn = 20;
      this.stamina = Math.min(STAMINA_MAX, this.stamina + 45);
      this.ctx.sfx.plink(4);
      this.flashStamina();
    }
    // E: give the nearest buddy a leg-up
    if (this.boostQueued) {
      this.boostQueued = false;
      let best: Climber | null = null;
      let bd = 1.6;
      for (const o of this.others) {
        const d = o.char.root.position.distanceTo(this.pos);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best && this.online) {
        this.ctx.net.send({ t: 'peakBoost', pid: this.ctx.net.myPeerId, to: best.pid });
        this.ctx.hud.banner(`Leg-up for ${best.name}! 🤝`, 1100, '#8be36b');
        this.me.char.setState('release');
        this.ctx.sfx.boing();
      } else if (!best) this.hint('Get close to a buddy, then press E to boost them', 3);
    }
  }

  private boosted(from: string): void {
    this.vel.y = JUMP_V * 1.45;
    this.launched = true;
    this.grounded = false;
    this.climbing = false;
    this.stamina = Math.min(STAMINA_MAX, this.stamina + 30);
    this.me.char.kick(0.7);
    this.ctx.sfx.boing();
    this.ctx.hud.banner(`${from} launched you! 🚀`, 1200, '#8be36b');
  }

  private reachSummit(): void {
    this.finished = true;
    this.me.doneTime = this.time;
    this.confetti.burst(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), 220);
    this.ctx.sfx.fanfare();
    this.ctx.hud.banner('SUMMIT! 🚩', 2200, '#ffd23f');
    if (this.online) this.ctx.net.send({ t: 'peakDone', pid: this.ctx.net.myPeerId, time: this.time });
    window.setTimeout(() => this.showBoard(), 1800);
  }

  // ---------------------------------------------------------------- network
  private sendState(): void {
    if (!this.online || !this.me) return;
    this.ctx.net.send({
      t: 'peak', pid: this.ctx.net.myPeerId, x: this.pos.x, y: this.pos.y, z: this.pos.z, ry: this.facing,
      s: this.me.char.state, best: this.me.best,
    });
  }

  private onNet(ev: SessionEvent): void {
    if (ev.e === 'host-lost') {
      this.ctx.hud.banner('Party ended', 1600, '#b9a3ff');
      this.ctx.exitToHub();
      return;
    }
    if (ev.e === 'gone') {
      this.dropClimber(ev.player.peerId);
      return;
    }
    if (ev.e === 'lobby') {
      // anyone no longer in the room leaves the mountain too
      const ids = new Set(this.ctx.net.players.map((p) => p.peerId));
      for (const o of [...this.others]) if (!ids.has(o.pid)) this.dropClimber(o.pid);
      return;
    }
    if (ev.e !== 'msg') return;
    const m: NetMsg = ev.m;
    if (m.t === 'peak') {
      const o = this.others.find((c) => c.pid === m.pid);
      if (!o) return;
      o.target = { x: m.x, y: m.y, z: m.z, ry: m.ry, s: m.s };
      o.best = Math.max(o.best, m.best);
    } else if (m.t === 'peakBoost' && m.to === this.ctx.net.myPeerId) {
      this.boosted(this.others.find((c) => c.pid === m.pid)?.name ?? 'A buddy');
    } else if (m.t === 'peakDone') {
      const o = this.others.find((c) => c.pid === m.pid);
      if (o && o.doneTime === null) {
        o.doneTime = m.time;
        this.ctx.hud.banner(`${o.name} reached the summit!`, 1500, '#ffd23f');
        if (this.boardEl) this.showBoard();
      }
    }
  }

  private dropClimber(pid: string): void {
    const i = this.others.findIndex((c) => c.pid === pid);
    if (i < 0) return;
    const o = this.others[i];
    this.scene.remove(o.char.root);
    disposeObject(o.char.root);
    o.label.remove();
    this.others.splice(i, 1);
    this.ctx.hud.banner(`${o.name} left 👋`, 1400, '#b9a3ff');
  }

  // ---------------------------------------------------------------- render
  update(dt: number, alpha: number): void {
    const t = performance.now() / 1000;
    if (this.ctx.input.wasPressed('Escape')) this.togglePause();
    if (this.ctx.input.wasPressed('KeyR') && !this.paused && !this.finished) this.splat();
    // Latch one-shot presses here (every rendered frame) — the fixed step can skip frames on
    // high-refresh screens, and presses are cleared at the end of each frame.
    if (this.started && !this.paused) {
      if (this.ctx.input.wasPressed('Space')) this.jumpBuffer = 0.16;
      if (this.ctx.input.wasPressed('KeyE')) this.boostQueued = true;
    }
    // me (interpolated)
    const r = this.me.char.root;
    r.position.lerpVectors(this.prevPos, this.pos, alpha);
    r.rotation.y = lerpAngle(r.rotation.y, this.facing, 1 - Math.exp(-dt * 14));
    // the rig's walk cycle is driven by real ground speed
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.me.char.speed = this.grounded && !this.climbing ? speed : 0;
    void t;
    // remote climbers
    for (const o of this.others) {
      const tg = o.target;
      if (!tg) continue;
      const k = 1 - Math.exp(-dt * 12);
      const or = o.char.root;
      o.char.speed = tg.s === 'walk' ? Math.min(5, Math.hypot(tg.x - or.position.x, tg.z - or.position.z) * 12 + 2) : 0;
      if (or.position.distanceTo(this.tmpV.set(tg.x, tg.y, tg.z)) > 6) or.position.copy(this.tmpV);
      else or.position.lerp(this.tmpV, k);
      or.rotation.y = lerpAngle(or.rotation.y, tg.ry, k);
      if (o.char.state !== tg.s) o.char.setState(tg.s as CharState);
    }
    for (const c of [this.me, ...this.others]) c.char.update(dt);
    this.mountain.update(dt, t);
    this.scenery.update(dt);
    this.confetti.update(dt);
    this.updateDust(dt);
    this.updateCamera(dt);
    this.updateHud();
    this.ctx.input.endFrame();
  }

  private tmpV = new THREE.Vector3();
  private skyLow = new THREE.Color('#bfe9ff');
  private skyHigh = new THREE.Color('#ffc9e0');
  private camTarget = new THREE.Vector3();

  private updateCamera(dt: number): void {
    // ride behind the climber; look-around drag eases back when you let go
    if (!this.dragLast) this.lookYaw *= Math.exp(-dt * 2.5);
    const behind = this.facing + Math.PI + this.lookYaw;
    this.yaw = lerpAngle(this.yaw, behind, 1 - Math.exp(-dt * (this.climbing ? 4 : 7)));
    const p = this.me.char.root.position;
    this.camTarget.lerp(this.tmpV.set(p.x, p.y + 0.9, p.z), 1 - Math.exp(-dt * 10));
    const d = this.camDist;
    const pit = Math.min(1.25, this.pitch + this.camLift * 0.7); // rise over rocks that block the view
    const cx = this.camTarget.x + Math.sin(this.yaw) * Math.cos(pit) * d;
    const cz = this.camTarget.z + Math.cos(this.yaw) * Math.cos(pit) * d;
    let cy = this.camTarget.y + Math.sin(pit) * d;
    cy = Math.max(0.5, cy);
    // spring-arm: if the pillar, a slab or a raft is between us and the camera, slide in front of it
    const o = this.camTarget;
    const dir = this.tmpV.set(cx - o.x, cy - o.y, cz - o.z);
    const len = dir.length();
    let reach = len;
    if (len > 0.01) {
      dir.divideScalar(len);
      const ray = new this.R.Ray({ x: o.x, y: o.y, z: o.z }, { x: dir.x, y: dir.y, z: dir.z });
      const hit = this.world.castRay(ray, len, true, undefined, undefined, this.collider, this.body);
      if (hit) reach = Math.max(0.8, hit.timeOfImpact - 0.25);
      this.camLift += ((reach < len * 0.6 ? 1 : 0) - this.camLift) * (1 - Math.exp(-dt * 3));
    }
    // ease outward (no popping), snap inward (never see through walls)
    this.camReach = reach < this.camReach ? reach : this.camReach + (reach - this.camReach) * (1 - Math.exp(-dt * 4));
    const k = this.camReach / Math.max(len, 0.01);
    this.camera.position.set(o.x + (cx - o.x) * k, o.y + (cy - o.y) * k, o.z + (cz - o.z) * k);
    this.camera.lookAt(this.camTarget);
    // the sky warms from day-blue to sunset as you climb
    const u = clamp(p.y / this.mountain.summit.y, 0, 1);
    (this.scene.background as THREE.Color).copy(this.skyLow).lerp(this.skyHigh, u);
    (this.scene.fog as THREE.Fog).color.copy(this.scene.background as THREE.Color);
    // shadows follow the climber
    this.sun.position.set(p.x + 8, p.y + 16, p.z + 5);
    this.sun.target.position.copy(p);
  }

  // ---------------------------------------------------------------- hud
  private buildHud(): void {
    const h = this.ctx.hud;
    h.clear();
    this.hudRoot = h.el('div', 'pk-hud');
    const top = h.el('div', 'pk-top', this.hudRoot);
    this.heightEl = h.el('div', 'pk-height', top);
    this.timerEl = h.el('div', 'pk-timer', top);
    const pause = h.el('button', 'pk-pause', top);
    pause.setAttribute('aria-label', 'Pause');
    pause.innerHTML = '<i></i><i></i>';
    pause.onclick = () => this.togglePause();
    const stam = h.el('div', 'pk-stam', this.hudRoot);
    stam.innerHTML = '<span>💪</span>';
    const bar = h.el('div', 'pk-stam-bar', stam);
    this.stamFill = h.el('div', 'pk-stam-fill', bar);
    this.teamEl = h.el('div', 'pk-team', this.hudRoot);
    this.hintEl = h.el('div', 'pk-hint', this.hudRoot);
  }

  private hintTimer = 0;
  private hint(text: string, seconds: number): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.remove('fade');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hintEl.classList.add('fade'), seconds * 1000);
  }

  private flashStamina(): void {
    const s = this.stamFill.parentElement!;
    s.classList.remove('flash');
    void s.offsetWidth;
    s.classList.add('flash');
  }

  private updateHud(): void {
    const top = this.mountain.summit.y;
    this.heightEl.textContent = `${Math.round(Math.max(0, this.pos.y))} m / ${Math.round(top)} m`;
    this.timerEl.textContent = fmtTime(this.me.doneTime ?? this.time);
    const pct = this.stamina / STAMINA_MAX;
    this.stamFill.style.width = `${pct * 100}%`;
    this.stamFill.parentElement!.classList.toggle('low', pct < 0.25);
    this.stamFill.parentElement!.parentElement!.classList.toggle('active', this.climbing || pct < 0.999);
    // team ladder: everyone's best height as a little bar
    const all = [this.me, ...this.others].sort((a, b) => (b.doneTime !== null ? 1e6 - b.doneTime : b.best) - (a.doneTime !== null ? 1e6 - a.doneTime : a.best));
    const html = all.map((c) => {
      const p = Math.min(1, c.best / top);
      const sp = SPECIES.find((s) => s.id === c.species);
      return `<div class="pk-row${c === this.me ? ' me' : ''}" style="--pc:${c.color}"><b>${sp?.emoji ?? '🫧'}</b><span>${esc(c.name)}</span><i style="width:${(p * 100).toFixed(1)}%"></i>${c.doneTime !== null ? '🚩' : ''}</div>`;
    }).join('');
    if (this.teamEl.dataset.html !== html) {
      this.teamEl.dataset.html = html;
      this.teamEl.innerHTML = html;
    }
    // floating name tags
    const v = this.tmpV;
    for (const c of [this.me, ...this.others]) {
      v.copy(c.char.root.position).add(this.camTarget.clone().set(0, 1.35, 0)).project(this.camera);
      const vis = v.z < 1 && c.char.root.position.distanceTo(this.camera.position) < 40;
      c.label.style.display = vis ? '' : 'none';
      if (vis) c.label.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
    }
  }

  private showBoard(): void {
    this.boardEl?.remove();
    const el = this.ctx.hud.el('div', 'pk-board', this.hudRoot);
    this.boardEl = el;
    const all = [this.me, ...this.others].sort((a, b) => (a.doneTime ?? 1e9) - (b.doneTime ?? 1e9) || b.best - a.best);
    const medal = ['🥇', '🥈', '🥉', '🎖️'];
    el.innerHTML = `<div class="pk-card"><h2>Summit board</h2><ol>${all.map((c, i) => `<li style="--pc:${c.color}"><span>${c.doneTime !== null ? medal[i] ?? '🚩' : '🧗'}</span><b>${esc(c.name)}</b><em>${c.doneTime !== null ? fmtTime(c.doneTime) : `${Math.round(c.best)} m…`}</em></li>`).join('')}</ol>
      <div class="pk-actions"><button class="pk-btn primary" data-a="hub">Back to hub</button><button class="pk-btn" data-a="stay">Keep exploring</button></div></div>`;
    el.querySelector<HTMLButtonElement>('[data-a=hub]')!.onclick = () => this.ctx.exitToHub();
    el.querySelector<HTMLButtonElement>('[data-a=stay]')!.onclick = () => {
      el.remove();
      this.boardEl = null;
    };
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.pauseEl?.remove();
    this.pauseEl = null;
    if (!this.paused) return;
    const el = this.ctx.hud.el('div', 'pk-board', this.hudRoot);
    this.pauseEl = el;
    el.innerHTML = `<div class="pk-card"><h2>Paused</h2>${this.online ? '<p class="pk-muted">The climb keeps going for everyone else.</p>' : ''}
      <div class="pk-actions col"><button class="pk-btn primary" data-a="resume">Resume</button><button class="pk-btn" data-a="spawn">Back to last rest stop (R)</button><button class="pk-btn" data-a="hub">⏏ Exit to hub</button></div></div>`;
    el.querySelector<HTMLButtonElement>('[data-a=resume]')!.onclick = () => this.togglePause();
    el.querySelector<HTMLButtonElement>('[data-a=spawn]')!.onclick = () => {
      this.togglePause();
      this.splat();
    };
    el.querySelector<HTMLButtonElement>('[data-a=hub]')!.onclick = () => this.ctx.exitToHub();
  }

  private exposeDebug(): void {
    this.debug = {
      state: () => ({
        pos: this.pos.toArray().map((n) => +n.toFixed(2)), grounded: this.grounded, climbing: this.climbing,
        stamina: Math.round(this.stamina), best: +this.me.best.toFixed(1), checkpoint: this.checkpoint.index,
        finished: this.finished, others: this.others.map((o) => ({ name: o.name, best: o.best, at: o.char.root.position.toArray().map((n) => +n.toFixed(1)) })),
      }),
      teleport: (x: number, y: number, z: number) => {
        this.body.setTranslation({ x, y: y + CAP_HALF + CAP_R, z }, true);
        this.pos.set(x, y, z);
        this.prevPos.copy(this.pos);
        this.vel.set(0, 0, 0);
        this.airTop = y;
      },
      start: () => (this.started = true),
      summit: () => this.mountain.summit.toArray(),
      pads: () => this.mountain.pads.map((p) => p.pos.toArray()),
      rafts: () => this.mountain.movers.map((m) => m.pos.toArray()),
    };
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    this.unsub = [];
    this.ctx.hud.clear();
    disposeObject(this.scene);
    this.world.free();
  }
}

// ---------------------------------------------------------------- helpers
function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function readProfile(): { name: string; species: string; color: string } {
  try {
    const p = JSON.parse(localStorage.getItem('jb.profile') ?? '');
    if (p?.name) return p;
  } catch {
    /* fallthrough */
  }
  return { name: 'Climber', species: 'cat', color: JELLY_COLORS[0] };
}

// ---------------------------------------------------------------- run seed
let nextSeed: number | null = null;
/** Hub → game: the route seed for the next run (shared by the whole party). */
export function setPeakSeed(seed: number | undefined): void {
  nextSeed = seed ?? null;
}
function takePeakSeed(): number {
  const s = nextSeed ?? (Math.random() * 2 ** 31) | 0;
  nextSeed = null;
  return s;
}
