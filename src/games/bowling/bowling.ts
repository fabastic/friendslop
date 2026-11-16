import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { GameContext, Minigame } from '../../core/minigame.ts';
import { disposeObject } from '../../core/engine.ts';
import { PhysicsSync } from '../../core/physicsSync.ts';
import { toon } from '../../core/toon.ts';
import { addInkOutlines, type InkOptions } from '../../core/ink.ts';
import { fitModel } from '../../core/assets.ts';
import { JellyFolk, JELLY_COLORS, SPECIES, type Species, type CharState as CharStateName } from '../../characters/jellyfolk.ts';
import { Confetti } from './confetti.ts';
import {
  BALL_MASS, BALL_R, DECK_END_Z, HEAD_PIN_Z, LANE_HALF_W, PIN_H,
  buildArena, createPinBody, pinGeometry, pinSpots,
} from './world.ts';
import { frameMarks, gameStatus, provisionalScore, scoreGame } from './scoring.ts';
import { Reactions } from './reactions.ts';
import { makeCandyBench, GUTTER_W, PIN_SPACING, type Arena, type Reaction } from './world.ts';
import type { NetMsg, ThrowMsg } from '../../net/protocol.ts';
import { classifyLeave, pinNumbers, type Leave } from './leaves.ts';
import type { SessionEvent } from '../../net/session.ts';
import { BallHub, makeBallMesh, randomSkins, setBallSkin, useBallModel, type BallSkin } from './balls.ts';

export const BOWLING_ASSETS = ['keatura-bowling.glb'];

type Phase = 'setup' | 'aiming' | 'charging' | 'rolling' | 'settling' | 'result' | 'board' | 'over';

interface Pin {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  active: boolean;
  /** Counted as knocked down at the end of the last ball (sweep uses this, not a live re-check). */
  counted: boolean;
  /** hit by something this roll (for the star burst / plink) */
  hit: boolean;
  /** visual jelly wobble spring (scale only; physics untouched) */
  wob: number;
  wobV: number;
  idx: number;
}

export interface PlayerConfig {
  name: string;
  species: Species;
  color: string;
}

/** Free-roam state for online party play (everyone but the current bowler roams). */
interface RoamState {
  x: number;
  z: number;
  ry: number;
  y: number;
  vy: number;
  /** visual waddle bob while walking (not simulated) */
  bob?: number;
}

interface Player extends PlayerConfig {
  rolls: number[];
  char: JellyFolk;
  seat: THREE.Vector3;
  react: number;
  /** online: roam target (sent over the wire), smoothed display state, and blocker body */
  roam?: RoamState;
  disp?: RoamState;
  body?: RAPIER.RigidBody;
  /** last aim state received from this player while they were the bowler */
  netAim?: { x: number; aim: number; spin: number; skin: number };
  /** online: latest roam position received for this (remote) player */
  netRoam?: { x: number; z: number; ry: number; y: number };
  /** being yanked onto the approach for their turn (0..1) */
  pull?: { from: THREE.Vector3; t: number };
  /** offline bench AI: sit for a while, wander about, hop */
  ai?: { mode: 'sit' | 'walk'; timer: number; tx: number; tz: number };
}

export interface ThrowParams {
  aim: number;
  power: number;
  spin: number;
}

const MAX_X = LANE_HALF_W - BALL_R - 0.04;
const MAX_AIM = 0.075;
const HAND_OFFSET = 0.2;
const HOOK_ACCEL = 0.9;
const CHAR_SCALE = 0.82;
const BOWLER_Z = 0.75;
const INK: InkOptions = {
  width: 2.2,
  skip: (m) => {
    const t = m.geometry.type;
    return t === 'PlaneGeometry' || t === 'CircleGeometry' || (m.geometry.boundingSphere?.radius ?? 0) > 30;
  },
};

/** Remembered between games so "Play again" keeps the same line-up. */
let lastConfig: PlayerConfig[] = [{ name: 'Player 1', species: 'cat', color: JELLY_COLORS[0] }];

/** Hub → game: pre-fill the setup line-up (e.g. with the party members). */
export function presetLineup(cfg: { name: string; species: string; color: string }[]): void {
  if (cfg.length) lastConfig = cfg.map((c) => ({ name: c.name, species: c.species as Species, color: c.color }));
}

export class Bowling implements Minigame {
  readonly id = 'bowling';
  readonly title = 'Jelly Bowl';
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  debug: Record<string, unknown> = {};

  private ctx!: GameContext;
  private R!: typeof RAPIER;
  private world!: RAPIER.World;
  private sync = new PhysicsSync();
  private pins: Pin[] = [];
  private ball!: RAPIER.RigidBody;
  private ballMesh!: THREE.Group;
  private confetti!: Confetti;
  private aimDots!: THREE.InstancedMesh;
  private hub!: BallHub;
  private arena!: Arena;
  private reactions!: Reactions;
  private skins: BallSkin[] = [];
  private hitCount = 0;
  private paused = false;
  private hintTimer = 0;
  private boardAnim: { el: HTMLElement; from: number; to: number }[] = [];
  private roundStart: number[] = [];
  private heldSkin: BallSkin | null = null;
  private grabFrom = new THREE.Vector3();
  private grabT = 1;
  private unsub: (() => void)[] = [];
  private seats: THREE.Vector3[] = [];

  private players: Player[] = [];
  private cur = 0;
  private turnFrame = 0;
  private config: PlayerConfig[] = lastConfig.map((c) => ({ ...c }));

  private phase: Phase = 'setup';
  private phaseTime = 0;
  private posX = 0;
  private aim = 0;
  private spin = 0;
  private power = 0;
  private hitSoundPlayed = false;
  private standingBefore = 10;
  private lastKnocked = 0;
  private camPos = new THREE.Vector3(0, 1.0, -1.6);
  private camLook = new THREE.Vector3(0, 0.5, 0.75);
  private tmp = new THREE.Vector3();
  private dragWindup = false;

  // HUD
  private hudRoot!: HTMLElement;
  private scorebar!: HTMLElement;
  private hintEl!: HTMLElement;
  private meterEl!: HTMLElement;
  private meterFill!: HTMLElement;
  private overlay: HTMLElement | null = null;
  private boardTimer = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.R = ctx.R;
    const R = this.R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 120; // two substeps per 60 Hz tick: steadier pin stacks, no tunnelling
    this.world.numSolverIterations = 8;

    this.arena = buildArena(R, this.world, this.scene);

    // Pins: keatura's pixel-art pin when loaded (CC BY), else the procedural lathe pin
    const pinModel = fitModel('keatura-bowling.glb', (n) => n.startsWith('Cube001_bowling') || n.startsWith('Cube.001_bowling'), PIN_H, { upright: true });
    const pinGeo = pinModel?.geometry ?? pinGeometry();
    const pinMat = pinModel?.map ? toon('#ffffff', { map: pinModel.map }, 0.5) : toon('#ffffff', { vertexColors: true });
    for (const home of pinSpots()) {
      const body = createPinBody(R, this.world, home);
      const mesh = new THREE.Mesh(pinGeo, pinMat);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.sync.add(body, mesh);
      this.pins.push({ body, mesh, home, active: true, counted: false, hit: false, wob: 0, wobV: 0, idx: this.pins.length });
    }

    // Ball + the ball machine
    this.ball = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic().setTranslation(0, BALL_R, 0.5).setCcdEnabled(true).setCanSleep(false).setAngularDamping(0.02),
    );
    this.world.createCollider(R.ColliderDesc.ball(BALL_R).setMass(BALL_MASS).setFriction(0.12).setRestitution(0.05), this.ball);
    this.ball.setEnabled(false);
    const ballModel = fitModel('keatura-bowling.glb', (n) => n.startsWith('Cube_bowling'), BALL_R * 2, { by: 'max' });
    ballModel?.geometry.translate(0, -BALL_R, 0);
    useBallModel(ballModel);
    // online rooms share one seeded ball set so a skin index means the same ball everywhere
    const skins = ctx.net.active ? randomSkins(5, 20261116) : randomSkins(5);
    this.skins = skins;
    this.hub = new BallHub(this.scene, skins);
    this.ballMesh = makeBallMesh(skins[0]);
    this.ballMesh.visible = false;
    this.scene.add(this.ballMesh);
    this.sync.add(this.ball, this.ballMesh);

    // Candy benches behind the approach where waiting players sit
    for (const [sx, seatCol, backCol] of [[-1, '#ff8fd0', '#ffd23f'], [1, '#3fd6ff', '#ff8fd0']] as const) {
      const bench = makeCandyBench(seatCol, backCol);
      const bx = sx * 1.3;
      const bz = 3.3;
      bench.group.position.set(bx, 0, bz);
      this.scene.add(bench.group);
      for (const off of [-0.3, 0.3]) this.seats.push(new THREE.Vector3(bx + off, bench.seatTop - 0.2, bz - 0.02));
    }

    // Aim guide
    this.aimDots = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.025, 12),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }),
      22,
    );
    this.aimDots.renderOrder = 2;
    this.aimDots.visible = false;
    this.scene.add(this.aimDots);

    this.confetti = new Confetti(this.scene);
    this.reactions = new Reactions(this.scene, pinGeo, pinMat, () => makeBallMesh(this.skins[Math.floor(Math.random() * this.skins.length)]));
    addInkOutlines(this.scene, INK);

    this.buildHud();
    this.applySettings();
    this.bindInput();
    this.resetRack(true);
    this.exposeDebug();
    const net = ctx.net;
    if (net.active && net.players.length > 0) {
      // Online party: line-up = room seat order, no local setup screen.
      this.online = true;
      this.pids = net.players.map((p) => p.peerId);
      this.unsub.push(net.on((ev) => this.onNet(ev)));
      // heartbeat on a timer (not the render loop) so a backgrounded tab still counts as present
      const hb = window.setInterval(() => this.sendRoam(), 1000);
      this.unsub.push(() => window.clearInterval(hb));
      this.startGame(net.players.map((p) => ({ name: p.name, species: p.species as Species, color: p.color })));
    } else this.showSetup();
  }

  // ---------------------------------------------------------------- online
  private online = false;
  /** Peer id per player index (stable across seat renumbering when someone leaves). */
  private pids: string[] = [];
  private pendingThrow: ThrowMsg | null = null;
  private remoteMask: number | null = null;
  private aimSendT = 0;
  private roamSendT = 0;
  private lastHeard = new Map<string, number>();

  private sendRoam(): void {
    const me = this.players[this.myIndex];
    if (!me) return;
    const r = me.roam ?? { x: me.char.root.position.x, z: me.char.root.position.z, ry: Math.PI, y: 0 };
    this.ctx.net.send({ t: 'roam', seat: this.ctx.net.mySeat, x: r.x, z: r.z, ry: r.ry, y: r.y, pid: this.myPid });
  }

  private get myPid(): string {
    return this.ctx.net.myPeerId;
  }

  /** Index of the player I control online (-1 offline). */
  private get myIndex(): number {
    return this.online ? this.pids.indexOf(this.myPid) : -1;
  }

  /** Offline: always. Online: only when the current bowler is me. */
  private get myTurn(): boolean {
    return !this.online || this.cur === this.myIndex;
  }

  private onNet(ev: SessionEvent): void {
    const net = this.ctx.net;
    if (ev.e === 'host-lost') {
      this.ctx.hud.banner('Party ended', 1800, '#b9a3ff');
      this.online = false;
      this.ctx.exitToHub();
      return;
    }
    if (ev.e === 'gone') {
      // host decides: drop the leaver from everyone's game
      const i = this.pids.indexOf(ev.player.peerId);
      if (i < 0) return;
      net.send({ t: 'remove', seat: i, name: ev.player.name, restartTurn: i === this.cur, endGame: false, pid: ev.player.peerId });
      this.removePlayer(ev.player.peerId, ev.player.name);
      return;
    }
    if (ev.e !== 'msg') return;
    const m: NetMsg = ev.m;
    if ('pid' in m && m.pid) this.lastHeard.set(m.pid, performance.now());
    const bowlerPid = this.pids[this.cur];
    switch (m.t) {
      case 'throw':
        if (m.pid !== this.myPid) this.pendingThrow = m;
        break;
      case 'roll':
        if (m.pid !== this.myPid) this.remoteMask = m.mask;
        break;
      case 'aim':
        if (m.pid === bowlerPid && !this.myTurn && this.phase === 'aiming') {
          this.posX = m.x;
          this.aim = m.aim;
          this.spin = m.spin;
          const skin = this.skins[m.skin];
          if (skin && this.heldSkin !== skin) {
            this.heldSkin = skin;
            setBallSkin(this.ballMesh, skin);
          }
        }
        break;
      case 'roam': {
        const p = this.players[this.pids.indexOf(m.pid ?? '')];
        if (p && p !== this.players[this.myIndex]) p.netRoam = { x: m.x, z: m.z, ry: m.ry, y: m.y };
        break;
      }
      case 'remove':
        if (m.pid) this.removePlayer(m.pid, m.name);
        break;
      case 'continue':
        if (this.phase === 'board') this.continueFromBoard();
        break;
    }
  }

  /** Someone left the party mid-game: take them out of the rotation without stalling the lane. */
  private removePlayer(pid: string, name: string): void {
    const i = this.pids.indexOf(pid);
    if (i < 0) return;
    const gone = this.players[i];
    this.scene.remove(gone.char.root);
    disposeObject(gone.char.root);
    this.players.splice(i, 1);
    this.pids.splice(i, 1);
    this.config.splice(i, 1);
    this.ctx.hud.banner(`${name} left 👋`, 1600, '#b9a3ff');
    if (this.players.length === 0) return this.ctx.exitToHub();
    this.players.forEach((p, k) => (p.seat = this.seats[k % this.seats.length]));
    const wasBowling = i === this.cur;
    if (i < this.cur) this.cur--;
    if (wasBowling) {
      this.pendingThrow = null;
      this.remoteMask = null;
      this.ball.setEnabled(false);
      this.heldSkin = null;
      if (this.cur >= this.players.length) this.cur = 0;
      if (this.phase !== 'board' && this.phase !== 'over') this.startTurn();
    }
    this.renderScorebar();
  }

  /** Replay a peer's throw once our flow has reached their aiming phase. */
  private applyPendingThrow(): void {
    const t = this.pendingThrow;
    if (!t || this.phase !== 'aiming' || this.myTurn) return;
    if (t.pid !== this.pids[this.cur]) return;
    this.pendingThrow = null;
    const skin = this.skins[t.skin];
    if (skin) {
      this.heldSkin = skin;
      setBallSkin(this.ballMesh, skin);
    }
    // reconcile which pins are in play with the thrower's view
    for (const pin of this.pins) {
      const want = (t.act & (1 << pin.idx)) !== 0;
      if (pin.active !== want) {
        pin.active = want;
        pin.body.setEnabled(want);
        pin.mesh.visible = want;
      }
    }
    this.posX = t.x;
    this.throwBall({ aim: t.aim, power: t.power, spin: t.spin }, true);
  }

  private get bowler(): Player {
    return this.players[this.cur];
  }

  // ---------------------------------------------------------------- players
  private buildPlayers(cfg: PlayerConfig[]): void {
    for (const p of this.players) {
      this.scene.remove(p.char.root);
      disposeObject(p.char.root);
    }
    this.players = cfg.map((c, i) => {
      const char = new JellyFolk(c.species, c.color);
      char.root.scale.setScalar(CHAR_SCALE);
      char.root.rotation.y = Math.PI;
      addInkOutlines(char.root, INK);
      if (!this.settings.ink) char.root.traverse((o) => { if (o.userData.isInk) o.visible = false; });
      this.scene.add(char.root);
      return { ...c, rolls: [], char, seat: this.seats[i % this.seats.length], react: 0 };
    });
    this.cur = 0;
  }

  // ---------------------------------------------------------------- pin-leave gags
  private pinNo: number[] = [];
  private gag: { leave: Leave; t: number; pins: Pin[] } | null = null;
  private leaveCard: HTMLElement | null = null;

  /** After a first ball leaves 1–9 pins: name the pattern and have the survivors act it out. */
  private startLeaveGag(standing: Pin[]): void {
    if (!this.pinNo.length) this.pinNo = pinNumbers(this.pins.map((p) => p.home));
    const leave = classifyLeave(standing.map((p) => this.pinNo[p.idx]));
    if (!leave) return;
    this.gag = { leave, t: 0, pins: standing };
    // pin diagram card: survivors bright, fallen faded
    this.leaveCard?.remove();
    const card = this.ctx.hud.el('div', `leave-card${leave.split ? ' split' : ''}`);
    const rows = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]];
    const up = new Set(leave.pins);
    card.innerHTML = `<div class="lc-pins">${rows.map((r) => `<div>${r.map((n) => `<i class="${up.has(n) ? 'up' : ''}" style="--k:${n}">${n}</i>`).join('')}</div>`).join('')}</div>
      <b>${leave.name}</b><span>${leave.caption}</span>`;
    this.leaveCard = card;
    window.setTimeout(() => {
      card.classList.add('out');
      window.setTimeout(() => card.remove(), 400);
    }, 2500);
  }

  private updateLeaveGag(dt: number): void {
    const g = this.gag;
    if (!g) return;
    if (this.phase !== 'result') {
      this.gag = null;
      return;
    }
    g.t += dt;
    const t = g.t;
    const env = Math.min(1, t * 3) * Math.min(1, Math.max(0, 2.6 - t) * 2); // ease in/out
    if (env <= 0) return;
    const cx = g.pins.reduce((a, p) => a + p.home.x, 0) / g.pins.length;
    g.pins.forEach((pin, k) => {
      const m = pin.mesh;
      const side = Math.sign(pin.home.x - cx) || (k % 2 ? 1 : -1);
      let tilt = 0;
      let hop = 0;
      let spin = 0;
      switch (g.leave.gag) {
        case 'shiver': // lonely pin trembling, then a nervous hop
          tilt = Math.sin(t * 70) * 0.05;
          hop = Math.max(0, Math.sin(t * 5)) * 0.05;
          break;
        case 'wave': // split groups lean away and wave across the gap
          tilt = side * (0.12 + Math.sin(t * 9 + k) * 0.12);
          hop = Math.max(0, Math.sin(t * 4.5 + side)) * 0.04;
          break;
        case 'highfive': // buddies lean in and bump heads
          tilt = -side * Math.max(0, Math.sin(t * 5)) * 0.3;
          hop = Math.max(0, Math.sin(t * 5)) * 0.03;
          break;
        case 'huddle': // swaying together
          tilt = Math.sin(t * 6) * 0.14;
          hop = Math.max(0, Math.sin(t * 12 + k * 0.6)) * 0.03;
          break;
        case 'stripe': // a hop running down the line
          hop = Math.max(0, Math.sin(t * 8 - k * 1.1)) * 0.09;
          tilt = Math.sin(t * 8 - k * 1.1) * 0.06;
          break;
        case 'taunt': // smug bouncing and twirling
          hop = Math.abs(Math.sin(t * 7 + k)) * 0.07;
          spin = t * 6 * (k % 2 ? 1 : -1);
          break;
        case 'gossip': // leaning toward a neighbour, whispering
          tilt = Math.sin(t * 3 + k * 1.7) * 0.18;
          break;
      }
      m.position.y += hop * env;
      m.rotateZ(tilt * env);
      if (spin) m.rotateY(spin * env);
    });
  }

  private skinIndex(): number {
    return Math.max(0, this.heldSkin ? this.skins.indexOf(this.heldSkin) : 0);
  }

  /**
   * Line-up preview during setup; then the bowler on the approach and everyone else free to
   * roam the area behind it (you steer your own bean online; offline beans wander on their own).
   * Whoever's up next gets yanked onto the approach with a stretchy hop.
   */
  private placePlayers(dt = 0): void {
    const t = performance.now() / 1000;
    this.players.forEach((p, i) => {
      const r = p.char.root;
      r.visible = true;
      if (this.phase === 'setup') {
        const n = this.players.length;
        r.position.set((i - (n - 1) / 2) * 0.55, 0, BOWLER_Z);
        r.rotation.y = Math.PI; // face the camera
        r.scale.setScalar(CHAR_SCALE);
        p.roam = undefined;
        if (p.char.state === 'sit') p.char.setState('idle');
        return;
      }
      if (i === this.cur) {
        const spot = this.tmp.set(this.posX + HAND_OFFSET, 0, BOWLER_Z);
        if (p.pull && p.pull.t < 1) {
          p.pull.t = Math.min(1, p.pull.t + dt / 0.85);
          const u = easeOut(p.pull.t);
          r.position.lerpVectors(p.pull.from, spot, u);
          r.position.y = Math.sin(p.pull.t * Math.PI) * 0.7;
          // stretched like jelly while flying, squashed on landing
          const s = Math.sin(p.pull.t * Math.PI);
          const land = p.pull.t > 0.85 ? Math.sin(((p.pull.t - 0.85) / 0.15) * Math.PI) * 0.25 : 0;
          r.scale.set(CHAR_SCALE * (1 - s * 0.25 + land), CHAR_SCALE * (1 + s * 0.45 - land), CHAR_SCALE * (1 - s * 0.25 + land));
          r.rotation.y = Math.PI + Math.sin(p.pull.t * Math.PI * 2) * 0.6;
          if (p.pull.t >= 1) {
            p.char.kick(0.5);
            this.ctx.sfx.boing();
          }
        } else {
          r.position.copy(spot);
          r.rotation.y = Math.PI;
          r.scale.setScalar(CHAR_SCALE);
        }
        p.roam = undefined;
        return;
      }
      r.scale.setScalar(CHAR_SCALE);
      this.roamStep(p, i, dt, t);
      r.position.set(p.roam!.x, p.roam!.y + (p.roam!.bob ?? 0), p.roam!.z);
      r.rotation.y = p.roam!.ry;
      // hide beans the camera is sweeping right past (no floating heads mid-flight)
      r.visible = this.camera.position.distanceTo(r.position) > 1.2;
    });
    // beans gently push each other apart
    for (let a = 0; a < this.players.length; a++) {
      for (let b = a + 1; b < this.players.length; b++) {
        const ra = this.players[a].roam;
        const rb = this.players[b].roam;
        if (!ra || !rb) continue;
        const dx = rb.x - ra.x;
        const dz = rb.z - ra.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 0.32) {
          const push = (0.32 - d) * 0.5;
          if (this.players[a].ai || a === this.myIndex) { ra.x -= (dx / d) * push; ra.z -= (dz / d) * push; }
          if (this.players[b].ai || b === this.myIndex) { rb.x += (dx / d) * push; rb.z += (dz / d) * push; }
        }
      }
    }
  }

  /** Move one non-bowling bean: keyboard (my bean online), network (others online) or bench AI (offline). */
  private roamStep(p: Player, i: number, dt: number, t: number): void {
    const from = p.char.root.position;
    if (!p.roam) p.roam = { x: from.x, z: from.z, ry: Math.PI, y: from.y, vy: 0 };
    const s = p.roam;
    let moving = false;
    if (this.online && i === this.myIndex) {
      const k = this.ctx.input.keys;
      const mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const mz = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
      if (mx || mz) {
        const len = Math.hypot(mx, mz);
        s.x += (mx / len) * 1.6 * dt;
        s.z += (mz / len) * 1.6 * dt;
        s.ry = Math.atan2(mx, mz);
        moving = true;
      }
      if (this.ctx.input.wasPressed('Space') && s.y <= 0.001) {
        s.vy = 3.2;
        p.char.kick(0.4);
        this.ctx.sfx.boing();
      }
    } else if (this.online) {
      const n = p.netRoam;
      if (n) {
        const k = 1 - Math.exp(-dt * 12);
        moving = Math.hypot(n.x - s.x, n.z - s.z) > 0.01;
        s.x += (n.x - s.x) * k;
        s.z += (n.z - s.z) * k;
        s.y = n.y;
        s.ry = n.ry;
      }
    } else {
      // offline bench AI: sit on the candy bench, get up, wander, hop about
      p.ai ??= { mode: 'walk', timer: 0, tx: p.seat.x, tz: p.seat.z };
      const ai = p.ai;
      ai.timer -= dt;
      if (ai.timer <= 0) {
        const sit = ai.mode === 'walk' && Math.random() < 0.55;
        ai.mode = sit ? 'sit' : 'walk';
        ai.timer = sit ? 4 + Math.random() * 5 : 2.5 + Math.random() * 3;
        if (sit) {
          ai.tx = p.seat.x;
          ai.tz = p.seat.z;
        } else {
          ai.tx = (Math.random() - 0.5) * 3.6;
          ai.tz = BOWLER_Z + 0.8 + Math.random() * 2.2;
        }
      }
      const dx = ai.tx - s.x;
      const dz = ai.tz - s.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const step = Math.min(d, 1.1 * dt);
        s.x += (dx / d) * step;
        s.z += (dz / d) * step;
        s.ry = Math.atan2(dx, dz);
        moving = true;
      } else if (ai.mode === 'sit') {
        s.ry = Math.PI;
      }
      if (ai.mode === 'walk' && s.y <= 0.001 && Math.random() < dt * 0.35) {
        s.vy = 2.4 + Math.random();
        p.char.kick(0.3);
      }
    }
    // gravity + hop
    if (!this.online || i === this.myIndex) {
      s.vy -= 9.8 * dt;
      s.y = Math.max(0, s.y + s.vy * dt);
      if (s.y === 0 && s.vy < 0) {
        if (s.vy < -2) p.char.kick(0.25);
        s.vy = 0;
      }
      // stay off the lane approach and inside the hall
      s.x = clamp(s.x, -2.1, 2.1);
      s.z = clamp(s.z, BOWLER_Z + 0.45, 3.7);
    }
    // pose: seated on the bench, otherwise a bouncy walk
    const atSeat = Math.hypot(s.x - p.seat.x, s.z - p.seat.z) < 0.08 && s.y === 0;
    s.bob = 0; // the rig's walk cycle does the bobbing now
    void t;
    p.char.speed = moving && s.y === 0 ? 1.4 : 0;
    if (p.react > 0) return;
    const want: CharStateName = atSeat && !moving ? 'sit' : moving && s.y === 0 ? 'walk' : s.y > 0.02 ? 'jump' : 'idle';
    if (p.char.state !== want) p.char.setState(want);
  }

  // ---------------------------------------------------------------- input
  private bindInput(): void {
    const { input, sfx } = this.ctx;
    this.unsub.push(
      input.onDrag((s) => {
        sfx.unlock();
        if (this.phase !== 'aiming' || s.length === 0 || !this.myTurn) {
          this.dragWindup = false;
          return;
        }
        const dy = s[s.length - 1].y - s[0].y;
        this.dragWindup = dy > 25;
        this.bowler.char.setState(this.dragWindup ? 'windup' : 'aim');
      }),
      input.onFlick((f) => {
        if (this.phase !== 'aiming' || !this.myTurn) return;
        this.dragWindup = false;
        if (f.vy > -250) {
          this.bowler.char.setState('idle');
          return;
        }
        const power = clamp((-f.vy - 250) / 2600, 0.08, 1);
        const aim = clamp(Math.atan2(f.vx, -f.vy) * 0.3, -MAX_AIM, MAX_AIM);
        const spin = clamp(f.curve / 1600, -1, 1);
        this.throwBall({ aim: this.aim + aim, power, spin: clamp(this.spin + spin, -1, 1) });
      }),
    );
  }

  private handleKeys(dt: number): void {
    const { input } = this.ctx;
    const k = input.keys;
    this.peek = k.has('Tab');
    if ((this.phase === 'aiming' || this.phase === 'charging') && this.myTurn) {
      if (k.has('ArrowLeft')) this.posX -= dt * 0.6;
      if (k.has('ArrowRight')) this.posX += dt * 0.6;
      if (k.has('KeyA')) this.aim -= dt * 0.08;
      if (k.has('KeyD')) this.aim += dt * 0.08;
      this.posX = clamp(this.posX, -MAX_X, MAX_X);
      this.aim = clamp(this.aim, -MAX_AIM, MAX_AIM);
      if (input.wasPressed('KeyQ')) this.spin = clamp(this.spin - 0.25, -1, 1);
      if (input.wasPressed('KeyE')) this.spin = clamp(this.spin + 0.25, -1, 1);
    }
    if (this.phase === 'aiming' && this.myTurn && input.wasPressed('Space')) {
      this.ctx.sfx.unlock();
      this.setPhase('charging');
    }
    if (this.phase === 'charging' && !k.has('Space')) {
      this.throwBall({ aim: this.aim, power: this.power, spin: this.spin });
    }
    if (input.wasPressed('Escape') && this.phase !== 'setup') this.togglePause();
    if (this.paused) return;
    if (input.wasPressed('Enter')) {
      if (this.phase === 'board') {
        if (!this.online || this.ctx.net.isHost) {
          if (this.online) this.ctx.net.send({ t: 'continue' });
          this.continueFromBoard();
        }
      } else if (this.phase === 'over') {
        if (this.online) this.ctx.exitToHub();
        else this.ctx.requestRestart();
      }
      else if (this.phase === 'setup') this.startGame();
    }
  }

  // ---------------------------------------------------------------- flow
  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
    this.meterEl?.classList.toggle('show', p === 'charging');
    this.scorebar?.classList.toggle('hidden', p === 'setup');
    this.hudRoot?.classList.toggle('in-setup', p === 'setup');
    if (p === 'aiming') {
      if (!this.heldSkin) this.grabBall();
      this.bowler.char.setState('idle');
      if (!this.myTurn) this.hint(`Waiting for ${this.bowler.name} to bowl… 🎳`);
      else this.hint(`${this.bowler.name}: flick up to bowl · drag down to wind up · ←/→ move · A/D aim · Q/E spin · or hold SPACE`);
    }
    if (p === 'charging') this.bowler.char.setState('windup');
  }

  /** Bowler takes a random ball off the return rack; it flies into their hand. */
  private grabBall(): void {
    const got = this.hub.pick();
    if (!got) return;
    this.heldSkin = got.skin;
    setBallSkin(this.ballMesh, got.skin);
    this.grabFrom.copy(got.from);
    this.grabT = 0;
    this.bowler.char.kick(0.2);
    this.ctx.sfx.pop();
  }

  startGame(cfg: PlayerConfig[] = this.config): void {
    if (cfg.length === 0) return;
    this.config = cfg.map((c) => ({ ...c }));
    lastConfig = this.config.map((c) => ({ ...c }));
    if (this.players.length !== cfg.length || this.players.some((p, i) => p.species !== cfg[i].species || p.color !== cfg[i].color)) {
      this.buildPlayers(cfg);
    }
    this.players.forEach((p, i) => {
      p.name = cfg[i].name || `Player ${i + 1}`;
      p.rolls = [];
    });
    this.closeOverlay();
    this.cur = 0;
    this.renderScorebar();
    this.startTurn();
  }

  private startTurn(): void {
    if (this.cur === 0) this.roundStart = this.players.map((pl) => provisionalScore(pl.rolls).total);
    const p = this.bowler;
    this.turnFrame = gameStatus(p.rolls).frame;
    this.resetRack(true);
    this.posX = 0;
    this.aim = 0;
    this.spin = 0;
    this.phase = 'aiming'; // so placePlayers puts the bowler on the approach
    // yank the next bowler out of the crowd onto the approach
    p.pull = { from: p.char.root.position.clone(), t: p.char.root.position.distanceTo(this.tmp.set(HAND_OFFSET, 0, BOWLER_Z)) > 0.2 ? 0 : 1 };
    p.ai = undefined;
    if (p.pull.t === 0) {
      this.ctx.sfx.tone(520, 0.18, 'sine', 0.2);
      p.char.setState('windup');
    }
    this.placePlayers();
    p.char.setState('idle');
    p.char.kick(0.35);
    if (this.players.length > 1) this.showTurnCard(p);
    this.renderScorebar();
    this.setPhase('aiming');
  }

  throwBall(t: ThrowParams, remote = false): void {
    if (this.phase !== 'aiming' && this.phase !== 'charging') return;
    if (!remote && !this.myTurn) return;
    if (this.online && !remote) {
      for (const p of this.pins) if (p.active && isPinDown(p)) p.active = false;
      let act = 0;
      for (const p of this.pins) if (p.active) act |= 1 << p.idx;
      this.ctx.net.send({
        t: 'throw', seat: this.ctx.net.mySeat, x: this.posX, aim: t.aim, power: t.power, spin: t.spin,
        skin: this.skinIndex(), sb: this.pins.filter((p) => p.active).length, act, pid: this.myPid,
      });
    }
    if (!remote) this.remoteMask = null; // a lagging spectator may already hold this roll's result
    const speed = 4.5 + clamp(t.power, 0, 1) * 5.5;
    const aim = clamp(t.aim, -MAX_AIM * 1.5, MAX_AIM * 1.5);
    this.spin = clamp(t.spin, -1, 1);
    const vx = Math.sin(aim) * speed;
    const vz = -Math.cos(aim) * speed;
    this.grabT = 1;
    this.ball.setEnabled(true);
    this.ball.setTranslation({ x: this.posX, y: BALL_R + 0.002, z: -0.05 }, true);
    this.ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.ball.setLinvel({ x: vx, y: 0, z: vz }, true);
    this.ball.setAngvel({ x: vz / BALL_R, y: -this.spin * 12, z: -vx / BALL_R }, true);
    this.sync.snap(this.ball);
    this.hitSoundPlayed = false;
    this.hitCount = 0;
    this.bounces = 0;
    for (const pin of this.pins) pin.hit = false;
    // only pins genuinely standing count for this ball (never phantom-score a fallen pin)
    for (const p of this.pins) if (p.active && isPinDown(p)) p.active = false;
    this.standingBefore = this.pins.filter((p) => p.active).length;
    this.bowler.char.setState('release');
    this.ctx.sfx.tone(180, 0.12, 'triangle', 0.25);
    this.setPhase('rolling');
    this.debug.lastThrow = { ...t, speed };
  }

  fixedUpdate(dt: number): void {
    if (this.paused && !this.online) return; // online play never freezes the shared lane
    this.phaseTime += dt;
    if (this.online) {
      this.applyPendingThrow();
      // stream my aim so the others see me shuffle on the approach
      this.aimSendT -= dt;
      if (this.myTurn && (this.phase === 'aiming' || this.phase === 'charging') && this.aimSendT <= 0) {
        this.aimSendT = 0.1;
        this.ctx.net.send({ t: 'aim', seat: this.ctx.net.mySeat, x: this.posX, aim: this.aim, spin: this.spin, skin: this.skinIndex(), pid: this.myPid });
      }
      // stream my roaming bean while someone else bowls
      this.roamSendT -= dt;
      const me = this.players[this.myIndex];
      if (me && !this.myTurn && this.roamSendT <= 0) {
        this.roamSendT = 0.1;
        this.sendRoam();
      }
      // host: a peer silent for 12 s has vanished (closed tab, lost wifi) — drop them
      const now = performance.now();
      if (this.ctx.net.isHost) {
        for (const pid of [...this.pids]) {
          if (pid === this.myPid) continue;
          const seen = this.lastHeard.get(pid) ?? (this.lastHeard.set(pid, now), now);
          if (now - seen > 12_000) {
            const p = this.players[this.pids.indexOf(pid)];
            this.lastHeard.delete(pid);
            this.ctx.net.send({ t: 'remove', seat: this.pids.indexOf(pid), name: p.name, restartTurn: false, endGame: false, pid });
            this.removePlayer(pid, p.name);
          }
        }
      }
    }

    if (this.phase === 'rolling') {
      const p = this.ball.translation();
      if (p.y < BALL_R + 0.02 && Math.abs(p.x) < LANE_HALF_W && p.z > HEAD_PIN_Z + 0.5) {
        const progress = clamp((-p.z - 5) / 11, 0, 1);
        this.ball.addForce({ x: this.spin * BALL_MASS * HOOK_ACCEL * progress, y: 0, z: 0 }, true);
      }
    }

    this.world.step();
    this.world.step();
    this.ball.resetForces(false);
    this.sync.afterStep();

    if (this.phase === 'charging') {
      const ph = (this.phaseTime / 1.3) % 2;
      this.power = ph < 1 ? ph : 2 - ph;
    }

    if (this.phase === 'rolling') {
      const p = this.ball.translation();
      const v = this.ball.linvel();
      const speed = Math.hypot(v.x, v.z);
      if (!this.hitSoundPlayed && p.z < HEAD_PIN_Z + 0.25 && Math.abs(p.x) < LANE_HALF_W + 0.05) {
        this.hitSoundPlayed = true;
        this.ctx.sfx.crash(clamp(speed / 9, 0.3, 1));
      }
      this.bumpers(p, v);
      const done = p.z < DECK_END_Z - 0.2 || p.y < -0.3 || this.phaseTime > 9 || (speed < 0.15 && this.phaseTime > 1);
      if (done) this.setPhase('settling');
    } else if (this.phase === 'settling') {
      const allQuiet = this.pins.every((pin) => !pin.active || pin.body.isSleeping() || isPinDown(pin) || linSpeed(pin.body) < 0.03);
      const settled = (allQuiet && this.phaseTime > 1.0) || this.phaseTime > 3.5;
      // spectators wait for the bowler's authoritative pin count (local physics as a fallback)
      // (no short timeout: a slow bowler's screen must never be out-voted; leavers are removed instead)
      const waiting = this.online && !this.myTurn && this.remoteMask === null && this.phaseTime < 90;
      if (settled && !waiting) this.finishRoll();
    } else if (this.phase === 'result') {
      if (this.phaseTime > 2.7) this.nextBall();
    } else if (this.phase === 'board' && this.boardTimer > 0) {
      this.boardTimer -= dt;
      if (this.boardTimer <= 0) this.continueFromBoard();
    }

    if (this.phase === 'rolling' || this.phase === 'settling') this.detectPinHits();
    const bp = this.ball.translation();
    if (this.ball.isEnabled() && bp.y < -1.5) this.ball.setEnabled(false);
  }

  private bounces = 0;

  /**
   * Springy gutters: a ball heading off the edge boings off the padded wall or gets popped out of
   * the gutter, hopping back toward the lane (a couple of times per roll, so gutters still happen).
   */
  private bumpers(p: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }): void {
    if (this.bounces >= 3 || p.z < HEAD_PIN_Z + 0.6) return;
    const side = Math.sign(p.x) || 1;
    const wallX = LANE_HALF_W + GUTTER_W - BALL_R - 0.015;
    const hitWall = Math.abs(p.x) > wallX && v.x * side > 0.05;
    const inGutter = Math.abs(p.x) > LANE_HALF_W + 0.03 && p.y < BALL_R - 0.03 && v.y <= 0.05;
    if (!hitWall && !inGutter) return;
    this.bounces++;
    const back = hitWall ? Math.abs(v.x) * 0.75 + 0.8 : 0.9 + Math.random() * 0.4;
    this.ball.setLinvel({ x: -side * back, y: 1.5 + Math.random() * 0.7, z: v.z * 0.92 }, true);
    this.ball.setAngvel({ x: (v.z * 0.92) / BALL_R, y: (Math.random() - 0.5) * 20, z: (side * back) / BALL_R }, true);
    this.ctx.sfx.boing();
    this.reactions.pinHit(new THREE.Vector3(side * (LANE_HALF_W + GUTTER_W), 0.1, p.z), 0.8);
    this.arena.react('hit');
    this.ballSquash = 1;
  }

  private ballSquash = 0;

  /** First contact on each pin: jelly wobble, star burst and a rising plink. */
  private detectPinHits(): void {
    for (const pin of this.pins) {
      if (!pin.active || pin.hit) continue;
      const lv = pin.body.linvel();
      const av = pin.body.angvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      const spin = Math.hypot(av.x, av.y, av.z);
      if (speed < 0.35 && spin < 2) continue;
      pin.hit = true;
      const strength = clamp(speed / 3, 0.3, 1);
      pin.wobV += 5 + strength * 6;
      const t = pin.body.translation();
      this.reactions.pinHit(new THREE.Vector3(t.x, t.y + 0.3, t.z), strength);
      this.ctx.sfx.plink(this.hitCount++);
      this.arena.react('hit');
    }
  }

  /** What just happened, for banners and reactions. 'hit' = an ordinary count. */
  private classify(knocked: number, cleared: boolean, strike: boolean, fresh: boolean, rolls: number[]): Reaction {
    if (strike) {
      let streak = 0;
      for (let i = rolls.length - 1; i >= 0 && rolls[i] === 10; i--) streak++;
      return streak >= 3 && streak % 3 === 0 ? 'turkey' : 'strike';
    }
    if (cleared) return 'spare';
    if (knocked === 0) return 'gutter';
    if (fresh && this.isSplit()) return 'split';
    return 'hit';
  }

  /** Head pin down and the standing pins fall into two or more separate groups. */
  private isSplit(): boolean {
    if (!this.pins[0].counted) return false;
    const standing = this.pins.filter((p) => p.active && !p.counted);
    if (standing.length < 2) return false;
    const seen = new Set<Pin>();
    let groups = 0;
    for (const s of standing) {
      if (seen.has(s)) continue;
      groups++;
      const stack = [s];
      seen.add(s);
      while (stack.length) {
        const c = stack.pop()!;
        for (const o of standing) {
          if (!seen.has(o) && c.home.distanceTo(o.home) < PIN_SPACING * 1.15) {
            seen.add(o);
            stack.push(o);
          }
        }
      }
    }
    return groups >= 2;
  }

  private finishRoll(): void {
    const p = this.bowler;
    let knocked = 0;
    const mask = this.online && !this.myTurn ? this.remoteMask : null;
    for (const pin of this.pins) {
      pin.counted = pin.active && (mask !== null ? (mask & (1 << pin.idx)) !== 0 : isPinDown(pin));
      if (pin.counted) knocked++;
    }
    this.remoteMask = null;
    if (this.online && this.myTurn) {
      let m = 0;
      for (const pin of this.pins) if (pin.counted) m |= 1 << pin.idx;
      this.ctx.net.send({ t: 'roll', seat: this.ctx.net.mySeat, mask: m, pid: this.myPid });
    }
    knocked = Math.min(knocked, this.standingBefore);
    this.lastKnocked = knocked;
    const statusBefore = gameStatus(p.rolls);
    p.rolls.push(knocked);
    this.renderScorebar();

    const cleared = knocked === this.standingBefore;
    const strike = cleared && statusBefore.freshRack;
    const kind = this.classify(knocked, cleared, strike, statusBefore.freshRack, p.rolls);
    if (statusBefore.freshRack && !cleared && knocked > 0) this.startLeaveGag(this.pins.filter((pin) => pin.active && !pin.counted));
    const { sfx, hud } = this.ctx;
    const deckFx = new THREE.Vector3(0, 0.5, HEAD_PIN_Z - 0.3);
    const at = new THREE.Vector3(this.posX + HAND_OFFSET, 0, BOWLER_Z);
    switch (kind) {
      case 'turkey':
        hud.banner('TURKEY! 🦃', 2000, '#ff8b4d');
        sfx.fanfare();
        this.confetti.burst(deckFx, 220);
        p.char.setState('strike');
        break;
      case 'strike':
        hud.banner('STRIKE!', 1700);
        sfx.fanfare();
        this.confetti.burst(deckFx, 160);
        p.char.setState('strike');
        break;
      case 'spare':
        hud.banner('SPARE!', 1500, '#3fd6ff');
        sfx.fanfare();
        this.confetti.burst(deckFx, 90);
        p.char.setState('dance');
        break;
      case 'split':
        hud.banner('SPLIT?!', 1500, '#3fd6ff');
        sfx.boing();
        p.char.setState('scratch');
        break;
      case 'gutter':
        hud.banner('GUTTER…', 1400, '#b9a3ff');
        sfx.sad();
        p.char.setState('flop');
        break;
      default:
        hud.banner(String(knocked), 900, '#ffffff');
        sfx.pop();
        p.char.setState(knocked >= 7 ? 'cheer' : 'sad');
    }
    if (kind !== 'hit') {
      this.reactions.play(kind, at);
      this.arena.react(kind);
    }
    // the bench reacts too
    for (const o of this.players) {
      if (o === p) continue;
      o.react = 2;
      o.char.setState(kind === 'strike' || kind === 'turkey' ? 'cheer' : kind === 'spare' ? 'dance' : kind === 'gutter' ? 'sad' : kind === 'split' ? 'scratch' : 'sit');
    }
    this.ball.setEnabled(false);
    if (this.heldSkin) {
      const bp = this.ball.translation();
      this.hub.sendBack(this.heldSkin, new THREE.Vector3(bp.x, bp.y, bp.z));
    }
    this.heldSkin = null;
    this.setPhase('result');
  }

  private nextBall(): void {
    const st = gameStatus(this.bowler.rolls);
    if (st.over || st.frame !== this.turnFrame) {
      this.endTurn();
      return;
    }
    this.resetRack(st.freshRack);
    this.spin = 0;
    this.aim = 0;
    this.setPhase('aiming');
  }

  private endTurn(): void {
    this.cur++;
    if (this.cur < this.players.length) {
      this.startTurn();
      return;
    }
    this.cur = 0;
    const allOver = this.players.every((p) => gameStatus(p.rolls).over);
    this.showBoard(this.turnFrame, allOver);
  }

  private continueFromBoard(): void {
    if (this.phase !== 'board') return;
    this.boardTimer = 0;
    this.closeOverlay();
    this.startTurn();
  }

  /** Fresh rack: all ten back. Otherwise knocked pins are swept and standing pins re-spotted. */
  private resetRack(fresh: boolean): void {
    for (const pin of this.pins) {
      const keep = fresh || (pin.active && !pin.counted);
      pin.active = keep;
      pin.counted = false;
      pin.body.setEnabled(keep);
      pin.mesh.visible = keep;
      if (keep) {
        // Teleport awake: a sleeping body's colliders aren't moved by setTranslation, so forcing
        // sleep here left invisible fallen colliders behind and the rack toppled on wake-up.
        pin.body.setTranslation(pin.home, true);
        pin.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        pin.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        pin.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        pin.wob = 0;
        pin.wobV = 0;
        this.sync.snap(pin.body);
      }
    }
  }

  // ---------------------------------------------------------------- render
  update(dt: number, alpha: number): void {
    this.handleKeys(dt);
    this.updateScoreVisibility();
    if (this.paused) {
      this.ctx.input.endFrame();
      return;
    }
    this.sync.render(alpha);
    // jelly wobble on hit pins (visual scale only)
    for (const pin of this.pins) {
      pin.wobV += (-pin.wob * 380 - pin.wobV * 9) * dt;
      pin.wob += pin.wobV * dt;
      const w = clamp(pin.wob * 0.04, -0.25, 0.25);
      pin.mesh.scale.set(1 + w * 0.6, 1 - w, 1 + w * 0.6);
    }
    this.reactions.update(dt);
    this.arena.setRolling(this.phase === 'rolling');
    if (this.colliderLines) this.updateColliderLines();
    // hints fade away after a few seconds
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hintEl.classList.add('fade');
    }
    if (this.phase === 'board' && this.boardAnim.length) {
      const u = easeOut(clamp((this.phaseTime - 0.5) / 1.2, 0, 1));
      let ticked = false;
      for (const a of this.boardAnim) {
        const v = String(Math.round(a.from + (a.to - a.from) * u));
        if (a.el.textContent !== v) {
          a.el.textContent = v;
          a.el.classList.remove('bump');
          void a.el.offsetWidth;
          a.el.classList.add('bump');
          ticked = true;
        }
      }
      if (ticked && this.phaseTime - this.lastTick > 0.06) {
        this.lastTick = this.phaseTime;
        this.ctx.sfx.tone(880 + u * 660, 0.04, 'square', 0.05);
      }
    }
    for (const p of this.players) {
      if (p.react > 0) p.react -= dt;
      p.char.update(dt);
    }
    this.placePlayers(dt);
    this.updateLeaveGag(dt);
    this.confetti.update(dt);
    this.hub.update(dt);
    this.arena.update(dt);

    const holding = (this.phase === 'aiming' || this.phase === 'charging') && !!this.heldSkin;
    if (holding) {
      this.bowler.char.handWorld(this.tmp);
      this.tmp.y = Math.max(this.tmp.y, BALL_R);
      if (this.grabT < 1) {
        // fly from the rack into the hand with a little hop
        this.grabT = Math.min(1, this.grabT + dt / 0.5);
        const u = easeOut(this.grabT);
        this.ballMesh.position.lerpVectors(this.grabFrom, this.tmp, u);
        this.ballMesh.position.y += Math.sin(u * Math.PI) * 0.35;
        this.ballMesh.rotation.x -= dt * 10;
      } else {
        this.ballMesh.position.copy(this.tmp);
      }
    }
    this.ballMesh.visible = holding || this.ball.isEnabled();
    this.ballSquash = Math.max(0, this.ballSquash - dt * 3);
    const bs = Math.sin(this.ballSquash * 18) * this.ballSquash * 0.3;
    this.ballMesh.scale.set(1 + bs, 1 - bs, 1 + bs);

    this.updateAimGuide(holding && this.grabT >= 1);
    if (this.phase === 'charging') this.meterFill.style.height = `${Math.round(this.power * 100)}%`;

    this.updateCamera(dt);
    this.ctx.input.endFrame();
    const v = this.ball.isEnabled() ? this.ball.linvel() : { x: 0, y: 0, z: 0 };
    const bp = this.ball.translation();
    this.ctx.sfx.roll(this.phase === 'rolling' && bp.y < BALL_R + 0.05 ? clamp(Math.hypot(v.x, v.z) / 9, 0, 1) : 0);
  }

  private updateAimGuide(show: boolean): void {
    this.aimDots.visible = show;
    if (!show) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const s = new THREE.Vector3(1, 1, 1);
    const t = performance.now() / 1000;
    let x = this.posX;
    let vx = Math.sin(this.aim) * 7.5;
    const vz = 7.5;
    let z = -0.1;
    const n = this.aimDots.count;
    for (let i = 0; i < n; i++) {
      const step = 0.4;
      const dtt = step / vz;
      const progress = clamp((-z - 5) / 11, 0, 1);
      vx += this.spin * HOOK_ACCEL * progress * dtt;
      x += vx * dtt;
      z -= step;
      const pulse = 0.8 + 0.4 * Math.max(0, Math.sin(t * 6 - i * 0.5));
      s.setScalar(pulse * (1 - i / (n * 1.6)));
      m.compose(new THREE.Vector3(clamp(x, -LANE_HALF_W, LANE_HALF_W), 0.004, z), q, s);
      this.aimDots.setMatrixAt(i, m);
    }
    this.aimDots.instanceMatrix.needsUpdate = true;
  }

  private updateCamera(dt: number): void {
    const wantPos = new THREE.Vector3();
    const wantLook = new THREE.Vector3();
    const bp = this.ballMesh.position;
    const bx = this.posX + HAND_OFFSET;
    switch (this.phase) {
      case 'setup':
        wantPos.set(0.2, 0.95, BOWLER_Z - 2.3);
        wantLook.set(0, 0.5, BOWLER_Z);
        break;
      case 'aiming':
      case 'charging':
        wantPos.set(this.posX - 0.15, 1.75, 3.9);
        wantLook.set(this.posX * 0.3, 0.05, -9);
        break;
      case 'rolling': {
        const z = Math.max(Math.min(bp.z, -1.5), HEAD_PIN_Z + 3.2);
        wantPos.set(bp.x * 0.5, 0.8 + 0.6 * clamp((z + 7) / 5.5, 0, 1), z + 2.6);
        wantLook.set(bp.x * 0.7, 0.12, z - 5);
        break;
      }
      default: {
        const reaction = this.phase === 'over' || this.phase === 'board' || (this.phase === 'result' && this.phaseTime > 1.0);
        if (reaction) {
          // front of the bowler, benches behind them
          wantPos.set(bx - 0.4, 0.85, BOWLER_Z - 1.9);
          wantLook.set(bx * 0.6, 0.5, BOWLER_Z + 0.5);
        } else {
          wantPos.set(0, 1.0, HEAD_PIN_Z + 2.6);
          wantLook.set(0, 0.15, HEAD_PIN_Z - 0.5);
        }
      }
    }
    const fast = this.phase === 'rolling' || this.phase === 'result' || this.phase === 'over';
    const k = 1 - Math.exp(-dt * (fast ? 6 : 3));
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // ---------------------------------------------------------------- HUD
  private buildHud(): void {
    const { hud } = this.ctx;
    this.hudRoot = hud.el('div');
    this.scorebar = hud.el('div', 'scorebar hidden', this.hudRoot);
    this.minibar = hud.el('div', 'minibar hidden', this.hudRoot);
    this.hintEl = hud.el('div', 'hint', this.hudRoot);
    this.meterEl = hud.el('div', 'meter', this.hudRoot);
    this.meterFill = hud.el('div', '', this.meterEl);
    const creditsBtn = hud.el('button', 'pill credits-btn', this.hudRoot);
    creditsBtn.textContent = 'Credits';
    creditsBtn.onclick = () => this.showCredits();
    this.turnCard = hud.el('div', 'turn-card', this.hudRoot);
    const pauseBtn = hud.el('button', 'pill pause-btn', this.hudRoot);
    // two CSS bars instead of the ⏸ glyph, whose font metrics sit off-centre
    pauseBtn.innerHTML = '<span class="pause-icon"><i></i><i></i></span>';
    pauseBtn.setAttribute('aria-label', 'Pause and settings (Esc)');
    pauseBtn.onclick = () => this.togglePause();
  }

  private hint(text: string, seconds = 6): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.remove('fade');
    this.hintEl.style.display = this.settings.hints ? '' : 'none';
    this.hintTimer = seconds;
  }

  /** Header: one row per player (avatar, ten frames, total), current bowler highlighted. */
  private renderScorebar(): void {
    const round = Math.min(10, Math.max(...this.players.map((p) => gameStatus(p.rolls).frame + (gameStatus(p.rolls).over ? 1 : 0)), 0) + (this.phase === 'board' ? 0 : 1));
    const head = `<div class="sb-head"><span class="sb-title">Jelly Bowl</span><span class="sb-round">Round ${Math.min(10, Math.max(1, round))}<small>/10</small></span></div>`;
    const frameNums = `<div class="sb-row sb-nums"><div class="sb-who"></div>${Array.from({ length: 10 }, (_, i) => `<div class="sb-cell${i === 9 ? ' tenth' : ''}">${i + 1}</div>`).join('')}<div class="sb-tot">Total</div></div>`;
    const rows = this.players.map((p, pi) => {
      const { frames } = scoreGame(p.rolls);
      const prov = provisionalScore(p.rolls);
      const total = prov.total;
      const anyPending = prov.pending.some(Boolean);
      const st = gameStatus(p.rolls);
      const sp = SPECIES.find((s) => s.id === p.species)!;
      const active = pi === this.cur && this.phase !== 'setup' && this.phase !== 'board' && this.phase !== 'over';
      const cells = Array.from({ length: 10 }, (_, f) => {
        const fr = frames[f];
        const marks = fr ? frameMarks(fr.rolls, f === 9) : [];
        const n = f === 9 ? 3 : 2;
        const ms = Array.from({ length: n }, (_, i) => `<i class="m${marks[i] === 'X' ? ' x' : marks[i] === '/' ? ' sp' : ''}">${marks[i] ?? ''}</i>`).join('');
        // provisional running score: strikes/spares show their points now, marked "pending"
        // until the bonus balls land (instead of a blank that reads as 0)
        const pend = fr ? prov.pending[f] : false;
        const cum = fr ? `${prov.cumulative[f]}${pend ? '<sup>+</sup>' : ''}` : '';
        const curCell = active && !st.over && st.frame === f;
        return `<div class="sb-cell${f === 9 ? ' tenth' : ''}${curCell ? ' cur' : ''}${pend ? ' pend' : ''}"><div class="marks">${ms}</div><div class="cum">${cum}</div></div>`;
      }).join('');
      return `<div class="sb-row${active ? ' active' : ''}" style="--pc:${p.color}"><div class="sb-who"><span class="avatar">${sp.emoji}</span><span class="nm">${escapeHtml(p.name)}</span></div>${cells}<div class="sb-tot${anyPending ? ' pend' : ''}" title="${anyPending ? 'Includes strike/spare bonus still to come' : ''}">${total}${anyPending ? '<sup>+</sup>' : ''}</div></div>`;
    }).join('');
    this.scorebar.innerHTML = head + frameNums + rows;
    // slim in-turn pill: whose go it is, which frame, their running score
    const b = this.players[this.cur];
    if (b) {
      const sp = SPECIES.find((s) => s.id === b.species)!;
      const prov = provisionalScore(b.rolls);
      const st = gameStatus(b.rolls);
      const pend = prov.pending.some(Boolean);
      this.minibar.style.setProperty('--pc', b.color);
      const peekHint = this.players.length > 1 ? '<span class="mb-peek">hold TAB for scores</span>' : '';
      this.minibar.innerHTML = `<span class="avatar">${sp.emoji}</span><b class="mb-name">${escapeHtml(b.name)}</b><span class="mb-frame">Frame ${Math.min(10, st.frame + 1)}<small>/10</small></span><span class="mb-score">${prov.total}${pend ? '<sup>+</sup>' : ''}</span>${peekHint}`;
    }
  }

  private turnCard!: HTMLElement;
  private minibar!: HTMLElement;
  private peek = false;

  /** Full scoreboard only between rounds (or while TAB is held); a slim pill during turns. */
  private updateScoreVisibility(): void {
    const between = this.phase === 'board' || this.phase === 'over';
    const full = this.phase !== 'setup' && (between || this.peek);
    this.scorebar.classList.toggle('hidden', !full);
    this.minibar.classList.toggle('hidden', full || this.phase === 'setup');
  }
  private lastTick = 0;
  private turnCardTimer = 0;

  /** Centered "your turn" card: avatar bubble in the player's colour, name, and frame number. */
  private showTurnCard(p: Player): void {
    const sp = SPECIES.find((s) => s.id === p.species)!;
    const frame = gameStatus(p.rolls).frame + 1;
    const c = this.turnCard;
    c.style.setProperty('--pc', p.color);
    c.innerHTML = `<span class="tc-avatar">${sp.emoji}</span><span class="tc-text"><b>${escapeHtml(p.name)}</b><small>${sp.name} · frame ${frame}</small></span><span class="tc-go">your turn!</span>`;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
    clearTimeout(this.turnCardTimer);
    this.turnCardTimer = window.setTimeout(() => c.classList.remove('show'), 1700);
    this.ctx.sfx.pop();
  }

  private closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private openOverlay(cls = ''): HTMLElement {
    this.closeOverlay();
    const ov = this.ctx.hud.el('div', `overlay ${cls}`, this.hudRoot);
    this.overlay = ov;
    return this.ctx.hud.el('div', 'card', ov);
  }

  /** Player setup: how many players, and each one's JellyFolk + colour. */
  private showSetup(): void {
    this.hudRoot.classList.add('in-setup');
    this.phase = 'setup';
    this.scorebar.classList.add('hidden');
    this.hint('Pick your JellyFolk, then press Start');
    if (this.players.length === 0) this.buildPlayers(this.config);
    this.placePlayers();
    const card = this.openOverlay('setup');
    const render = () => {
      card.innerHTML = '';
      const h = this.ctx.hud.el('h1', '', card);
      h.textContent = 'Jelly Bowl';
      const sub = this.ctx.hud.el('p', '', card);
      sub.textContent = 'Take turns, one frame each. Leaderboard after every round!';
      const count = this.ctx.hud.el('div', 'count-row', card);
      for (let n = 1; n <= 4; n++) {
        const b = this.ctx.hud.el('button', `chip${this.config.length === n ? ' on' : ''}`, count);
        b.textContent = `${n} player${n > 1 ? 's' : ''}`;
        b.onclick = () => {
          while (this.config.length < n) {
            const i = this.config.length;
            this.config.push({ name: `Player ${i + 1}`, species: SPECIES[i % SPECIES.length].id, color: JELLY_COLORS[i % JELLY_COLORS.length] });
          }
          this.config.length = n;
          this.buildPlayers(this.config);
          this.placePlayers();
          render();
        };
      }
      this.config.forEach((c, i) => {
        const row = this.ctx.hud.el('div', 'player-row', card);
        row.style.setProperty('--pc', c.color);
        const name = this.ctx.hud.el('input', 'name', row);
        name.value = c.name;
        name.maxLength = 12;
        name.oninput = () => (c.name = name.value);
        const sp = this.ctx.hud.el('div', 'species', row);
        const select = this.ctx.hud.el('select', 'animal-select', sp);
        select.setAttribute('aria-label', `${c.name} animal`);
        for (const s of SPECIES) {
          const o = this.ctx.hud.el('option', '', select);
          o.value = s.id;
          o.textContent = `${s.emoji}  ${s.name}`;
          o.selected = c.species === s.id;
        }
        select.onchange = () => {
          c.species = select.value;
          this.buildPlayers(this.config);
          this.placePlayers();
          render();
        };
        const dice = this.ctx.hud.el('button', 'chip dice', sp);
        dice.textContent = '🎲';
        dice.title = 'Random animal';
        dice.onclick = () => {
          c.species = SPECIES[Math.floor(Math.random() * SPECIES.length)].id;
          this.buildPlayers(this.config);
          this.placePlayers();
          render();
        };
        const cols = this.ctx.hud.el('div', 'swatches', row);
        for (const col of JELLY_COLORS) {
          const b = this.ctx.hud.el('button', `swatch${c.color === col ? ' on' : ''}`, cols);
          b.style.background = col;
          b.setAttribute('aria-label', `colour ${col}`);
          b.onclick = () => {
            c.color = col;
            this.buildPlayers(this.config);
            this.placePlayers();
            render();
          };
        }
        void i;
      });
      const go = this.ctx.hud.el('button', 'btn', card);
      go.textContent = 'Start ▶';
      go.onclick = () => this.startGame();
    };
    render();
  }

  /** Leaderboard after each round (and the final results). */
  private showBoard(frame: number, final: boolean): void {
    this.phase = final ? 'over' : 'board';
    this.phaseTime = 0;
    this.renderScorebar();
    const ranked = [...this.players].map((p) => ({ p, total: provisionalScore(p.rolls).total })).sort((a, b) => b.total - a.total);
    const leader = ranked[0].p;
    for (const p of this.players) {
      p.react = 3;
      p.char.setState(p === leader ? 'cheer' : 'idle');
    }
    // leader steps up to the approach for the camera
    this.cur = this.players.indexOf(leader);
    this.placePlayers();
    this.cur = final ? this.cur : 0;
    const card = this.openOverlay('board');
    const title = final ? (this.players.length > 1 ? `${escapeHtml(leader.name)} wins!` : 'Game over') : `Round ${frame + 1} complete`;
    const medals = ['🥇', '🥈', '🥉', '4'];
    const rows = ranked.map(({ p, total }, i) => {
      const sp = SPECIES.find((s) => s.id === p.species)!;
      const fr = scoreGame(p.rolls).frames[frame];
      const marks = fr ? frameMarks(fr.rolls, frame === 9) : [];
      const markHtml = marks.map((m) => `<b class="mk${m === 'X' ? ' x' : m === '/' ? ' sp' : ''}">${m}</b>`).join('');
      const pi = this.players.indexOf(p);
      const start = this.roundStart[pi] ?? 0;
      const gained = total - start;
      const crown = i === 0 && this.players.length > 1 ? '<span class="lb-crown">👑</span>' : '';
      const side = i % 2 ? 'r' : 'l';
      return `<div class="lb-row from-${side}${i === 0 ? ' lead' : ''}" style="--pc:${p.color};--i:${i}"><span class="lb-rank">${medals[i]}</span><span class="avatar">${crown}${sp.emoji}</span><span class="lb-name">${escapeHtml(p.name)}</span><span class="lb-frame">${markHtml}</span><span class="lb-plus">${gained > 0 ? '+' + gained : '±0'}</span><span class="lb-total" data-p="${pi}">${final ? total : start}</span></div>`;
    }).join('');
    // final results get a podium for the top three
    let podium = '';
    if (final && this.players.length > 1) {
      const order = [1, 0, 2].filter((i) => i < ranked.length);
      podium = `<div class="podium">${order.map((i) => {
        const { p, total } = ranked[i];
        const sp = SPECIES.find((s) => s.id === p.species)!;
        return `<div class="pd pd-${i + 1}" style="--pc:${p.color};--i:${2 - i}"><span class="pd-ava">${sp.emoji}</span><span class="pd-name">${escapeHtml(p.name)}</span><span class="pd-block"><b>${i + 1}</b><small>${total}</small></span></div>`;
      }).join('')}</div>`;
    }
    const sub = final && this.players.length === 1 ? `<p class="final-score">Final score <b>${ranked[0].total}</b></p>` : final ? '' : `<p class="lb-sub">Round ${frame + 1} of 10</p>`;
    card.innerHTML = `<h1 class="lb-title">${title}</h1>${sub}${podium}<div class="lb">${rows}</div>`;
    this.boardAnim = [];
    const btn = this.ctx.hud.el('button', 'btn', card);
    if (final) {
      btn.textContent = 'Play again';
      btn.onclick = () => this.ctx.requestRestart();
      this.hint('Press ENTER or tap Play again');
      this.ctx.sfx.fanfare();
      this.confetti.burst(new THREE.Vector3(0, 1.2, BOWLER_Z + 0.5), 160);
    } else {
      // quick 4-second pop-up: totals count up from where the round started; tap to skip
      btn.remove();
      this.overlay!.onclick = () => this.continueFromBoard();
      const bar = this.ctx.hud.el('div', 'lb-timer', card);
      bar.style.animationDuration = '4s';
      this.boardTimer = 4;
      this.boardAnim = [...card.querySelectorAll<HTMLElement>('.lb-total')].map((el) => {
        const i = Number(el.dataset.p);
        return { el, from: this.roundStart[i] ?? 0, to: provisionalScore(this.players[i].rolls).total };
      });
      this.hint('Tap or ENTER to skip', 4);
    }
  }

  // ---------------------------------------------------------------- pause menu + settings
  private settings: Settings = loadSettings();
  private colliderLines: THREE.LineSegments | null = null;
  private pauseReturn: Phase | null = null;

  togglePause(force?: boolean): void {
    const want = force ?? !this.paused;
    if (want === this.paused || this.phase === 'setup') return;
    this.paused = want;
    if (want) this.showPause();
    else {
      this.closeOverlay();
      // a board/over card was replaced by the pause menu: bring it back
      if (this.pauseReturn === 'board' || this.pauseReturn === 'over') this.showBoard(Math.max(0, this.turnFrame), this.pauseReturn === 'over');
    }
  }

  private showPause(): void {
    this.pauseReturn = this.phase === 'board' || this.phase === 'over' ? this.phase : null;
    const card = this.openOverlay('pause');
    const h = this.ctx.hud;
    h.el('h1', '', card).textContent = 'Paused';
    const menu = h.el('div', 'pause-menu', card);
    const button = (label: string, cls: string, fn: () => void) => {
      const b = h.el('button', cls, menu);
      b.textContent = label;
      b.onclick = fn;
      return b;
    };
    button('▶ Resume', 'btn', () => this.togglePause(false));
    button('↻ Restart game', 'pill wide', () => {
      this.paused = false;
      this.closeOverlay();
      this.startGame(this.config);
    });
    button('👥 Change players', 'pill wide', () => {
      this.paused = false;
      this.closeOverlay();
      this.showSetup();
    });
    button('⏏ Exit to hub', 'pill wide', () => {
      this.paused = false;
      this.ctx.exitToHub();
    });

    const set = h.el('div', 'settings', card);
    h.el('h2', '', set).textContent = 'Settings';
    const row = (label: string) => {
      const r = h.el('label', 'set-row', set);
      h.el('span', '', r).textContent = label;
      return r;
    };
    const vol = h.el('input', '', row('🔊 Volume'));
    vol.type = 'range';
    vol.min = '0';
    vol.max = '1';
    vol.step = '0.05';
    vol.value = String(this.settings.volume);
    vol.oninput = () => this.updateSetting('volume', Number(vol.value));
    const toggle = (label: string, key: 'hints' | 'ink' | 'colliders' | 'shake') => {
      const c = h.el('input', '', row(label));
      c.type = 'checkbox';
      c.checked = this.settings[key];
      c.onchange = () => this.updateSetting(key, c.checked);
    };
    const q = h.el('select', 'animal-select', row('✨ Graphics'));
    for (const [v, t] of [['high', 'High (shadows, sharp)'], ['low', 'Low (faster)']] as const) {
      const o = h.el('option', '', q);
      o.value = v;
      o.textContent = t;
      o.selected = this.settings.quality === v;
    }
    q.onchange = () => this.updateSetting('quality', q.value as Settings['quality']);
    toggle('🖊 Ink outlines', 'ink');
    toggle('💬 Show hints', 'hints');
    toggle('🧱 Show colliders (debug)', 'colliders');
    h.el('p', 'small', card).textContent = 'ESC to resume';
  }

  private updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings[key] = value;
    saveSettings(this.settings);
    this.applySettings();
  }

  private applySettings(): void {
    const s = this.settings;
    this.ctx.sfx.setVolume(s.volume);
    const r = this.ctx.renderer;
    const pr = s.quality === 'low' ? 1 : Math.min(window.devicePixelRatio, 2);
    if (r.getPixelRatio() !== pr) {
      r.setPixelRatio(pr);
      window.dispatchEvent(new Event('resize'));
    }
    const shadows = s.quality === 'high';
    if (r.shadowMap.enabled !== shadows) {
      r.shadowMap.enabled = shadows;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m) m.needsUpdate = true;
      });
    }
    this.scene.traverse((o) => {
      if (o.userData.isInk) o.visible = s.ink;
    });
    this.hintEl.style.display = s.hints ? '' : 'none';
    if (s.colliders && !this.colliderLines) {
      this.colliderLines = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85 }),
      );
      this.colliderLines.renderOrder = 10;
      this.colliderLines.frustumCulled = false;
      this.scene.add(this.colliderLines);
      this.updateColliderLines();
    } else if (!s.colliders && this.colliderLines) {
      this.scene.remove(this.colliderLines);
      this.colliderLines.geometry.dispose();
      (this.colliderLines.material as THREE.Material).dispose();
      this.colliderLines = null;
    }
  }

  /** Rapier's own wireframe of every collider, to check physics against visuals. */
  private updateColliderLines(): void {
    const lines = this.colliderLines;
    if (!lines) return;
    const { vertices, colors } = this.world.debugRender();
    const g = lines.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  }

  private showCredits(): void {
    const prevPhase = this.phase;
    const card = this.openOverlay('credits');
    card.innerHTML = `<h1>Credits</h1><ul class="credit-list">
      <li><b>Bowling Ball and Bowling Pin</b> by keatura · CC BY 4.0</li>
      <li>JellyFolk astronauts inspired by <b>Low-Poly JellyCat</b> by romensf (CC BY 4.0)</li>
      <li><b>Bench</b> by Tombolaso · CC BY-NC 4.0</li>
      <li>Jelly Peak props: <b>Magical Find</b> by Ergoni · <b>Froggie Pie!! by Lemonscribs</b> by wilemben · <b>Pawtisserie</b> by CuteLeaf · all CC BY 4.0</li>
      <li>All models via Sketchfab · rendering three.js · physics Rapier</li>
      <li>All 24 JellyFolk, the Jelly Lift, the ball console and Pinbot are original to Jelly Bowl</li></ul>`;
    const btn = this.ctx.hud.el('button', 'btn', card);
    btn.textContent = 'Close';
    btn.onclick = () => {
      this.closeOverlay();
      if (prevPhase === 'setup') this.showSetup();
      else if (prevPhase === 'board' || prevPhase === 'over') this.showBoard(Math.max(0, this.turnFrame), prevPhase === 'over');
    };
  }

  // ---------------------------------------------------------------- debug
  private exposeDebug(): void {
    this.debug = {
      start: (cfg?: PlayerConfig[]) => this.startGame(cfg ?? this.config),
      continue: () => this.continueFromBoard(),
      /** Preview the round leaderboard or the final podium. */
      board: (final = false) => this.showBoard(Math.max(0, this.turnFrame), final),
      /** Preview a reaction without bowling (strike, spare, split, gutter, turkey). */
      react: (kind: Reaction) => {
        const states: Record<string, CharStateName> = { strike: 'strike', turkey: 'strike', spare: 'dance', split: 'scratch', gutter: 'flop' };
        this.phase = 'result';
        this.phaseTime = 1.2;
        this.bowler.char.setState(states[kind] ?? 'cheer');
        this.reactions.play(kind, new THREE.Vector3(this.posX + HAND_OFFSET, 0, BOWLER_Z));
        this.arena.react(kind);
      },
      throw: (aim = 0, power = 0.8, spin = 0, x?: number) => {
        if (x !== undefined) this.posX = clamp(x, -MAX_X, MAX_X);
        this.throwBall({ aim, power, spin });
      },
      state: () => ({
        phase: this.phase,
        cur: this.cur,
        players: this.players.map((p) => ({ name: p.name, species: p.species, rolls: [...p.rolls], total: scoreGame(p.rolls).total, over: gameStatus(p.rolls).over })),
        rolls: this.players[this.cur] ? [...this.players[this.cur].rolls] : [],
        total: this.players[this.cur] ? scoreGame(this.players[this.cur].rolls).total : 0,
        pinsStanding: this.pins.filter((p) => p.active && !isPinDown(p)).length,
        lastKnocked: this.lastKnocked,
        rack: this.hub.seated,
        travelling: this.hub.travelling,
        ball: this.ball.isEnabled() ? { ...this.ball.translation() } : null,
      }),
    };
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    this.unsub = [];
    this.ctx.sfx.roll(0);
    this.ctx.hud.clear();
    this.sync.clear();
    this.world.free();
    disposeObject(this.scene);
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    this.scene.clear();
  }
}

// ------------------------------------------------------------------ helpers
const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

function isPinDown(pin: Pin): boolean {
  const t = pin.body.translation();
  const r = pin.body.rotation();
  tmpQ.set(r.x, r.y, r.z, r.w);
  const upY = tmpV.copy(UP).applyQuaternion(tmpQ).y;
  const moved = Math.hypot(t.x - pin.home.x, t.z - pin.home.z);
  return upY < 0.8 || t.y < -0.03 || t.y > 0.2 || Math.abs(t.x) > LANE_HALF_W + 0.02 || t.z < DECK_END_Z || moved > 0.5;
}

function linSpeed(b: RAPIER.RigidBody): number {
  const v = b.linvel();
  return Math.hypot(v.x, v.y, v.z);
}

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ------------------------------------------------------------------ settings
export interface Settings {
  volume: number;
  quality: 'high' | 'low';
  ink: boolean;
  hints: boolean;
  colliders: boolean;
  shake: boolean;
}
const SETTINGS_KEY = 'jellybash.settings';
const DEFAULT_SETTINGS: Settings = { volume: 0.5, quality: 'high', ink: true, hints: true, colliders: false, shake: true };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), colliders: false };
  } catch {
    /* storage unavailable: defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, colliders: false }));
  } catch {
    /* ignore */
  }
}
