import * as THREE from 'three';
import { toon } from '../../core/toon.ts';
import type { Reaction } from './world.ts';

/**
 * Comedy layer: squishy decorative "pin buddies" (and a ball buddy) that pop up around the bowler
 * to celebrate or tease, a rain cloud for gutter balls, and star bursts where pins get hit.
 * Everything here is visual only — no physics — and bounces with squash-and-stretch.
 */

interface Buddy {
  obj: THREE.Object3D;
  /** local animation clock */
  t: number;
  life: number;
  base: THREE.Vector3;
  kind: 'ring' | 'hop' | 'giggle' | 'flank' | 'ballHop';
  phase: number;
  scale: number;
}

interface Star {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  spin: number;
}

export class Reactions {
  private group = new THREE.Group();
  private buddies: Buddy[] = [];
  private stars: Star[] = [];
  private cloud: THREE.Group | null = null;
  private cloudT = 0;
  private drops: THREE.Mesh[] = [];
  private starGeo: THREE.BufferGeometry;
  private starMats: THREE.MeshBasicMaterial[];
  private pinGeo: THREE.BufferGeometry;
  private pinMat: THREE.Material;
  private makeBall: () => THREE.Object3D;

  constructor(scene: THREE.Scene, pinGeo: THREE.BufferGeometry, pinMat: THREE.Material, makeBall: () => THREE.Object3D) {
    scene.add(this.group);
    this.pinGeo = pinGeo;
    this.pinMat = pinMat;
    this.makeBall = makeBall;
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 ? 0.018 : 0.042;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    this.starGeo = new THREE.ShapeGeometry(s);
    this.starMats = ['#ffd23f', '#ffffff', '#ff8fd0', '#3fd6ff'].map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
  }

  /** Little star burst where a pin got smacked. */
  pinHit(at: THREE.Vector3, strength: number): void {
    const n = 4 + Math.round(strength * 5);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.starGeo, this.starMats[i % this.starMats.length]);
      m.position.copy(at);
      m.userData.noInk = true;
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 1.6 * strength;
      this.stars.push({ mesh: m, vel: new THREE.Vector3(Math.cos(a) * sp, 1.2 + Math.random() * 2, Math.sin(a) * sp * 0.6 + 0.4), life: 0.7 + Math.random() * 0.3, spin: (Math.random() - 0.5) * 20 });
      this.group.add(m);
    }
  }

  /** Celebrate / tease around the bowler. `facing` is the bowler's yaw. */
  play(kind: Reaction, center: THREE.Vector3): void {
    this.clearBuddies();
    const pin = () => {
      const m = new THREE.Mesh(this.pinGeo, this.pinMat);
      m.castShadow = true;
      const g = new THREE.Group();
      g.add(m);
      // two dot eyes and a smile so the pin buddies have personality
      const ink = toon('#2a1b4a', {}, 0);
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), ink);
        e.position.set(sx * 0.018, 0.33, 0.03);
        e.userData.noInk = true;
        g.add(e);
      }
      return g;
    };
    const add = (obj: THREE.Object3D, kindB: Buddy['kind'], base: THREE.Vector3, phase: number, life: number, scale = 1.4) => {
      obj.position.copy(base);
      obj.scale.setScalar(0.001);
      this.group.add(obj);
      this.buddies.push({ obj, t: -phase * 0.12, life, base, kind: kindB, phase, scale });
    };
    switch (kind) {
      case 'strike':
      case 'turkey': {
        // pins dance in a ring around the bowler, a ball buddy bounces through the middle
        const n = kind === 'turkey' ? 8 : 6;
        for (let i = 0; i < n; i++) add(pin(), 'ring', center.clone(), i, 2.6);
        add(this.makeBall(), 'ballHop', center.clone().add(new THREE.Vector3(0, 0, -0.35)), 0, 2.4, 1.6);
        break;
      }
      case 'spare':
        for (let i = 0; i < 3; i++) add(pin(), 'hop', center.clone().add(new THREE.Vector3((i - 1) * 0.35, 0, -0.45)), i, 2.2);
        break;
      case 'split':
        for (const sx of [-1, 1]) add(pin(), 'flank', center.clone().add(new THREE.Vector3(sx * 0.55, 0, -0.1)), sx > 0 ? 1 : 0, 2.4);
        break;
      case 'gutter':
        add(pin(), 'giggle', center.clone().add(new THREE.Vector3(0.45, 0, -0.3)), 0, 2.4);
        this.rainOn(center);
        break;
      default:
        break;
    }
  }

  private rainOn(center: THREE.Vector3): void {
    this.clearCloud();
    const c = new THREE.Group();
    const mat = toon('#9a9ab8', {}, 0.3);
    for (let k = 0; k < 4; k++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.1 + (k % 2) * 0.03, 12, 8), mat);
      p.position.set((k - 1.5) * 0.09, (k % 2) * 0.04, 0);
      p.scale.y = 0.75;
      c.add(p);
    }
    c.position.copy(center).add(new THREE.Vector3(0, 1.25, 0));
    this.group.add(c);
    this.cloud = c;
    this.cloudT = 2.6;
    const dropMat = new THREE.MeshBasicMaterial({ color: '#5fb8ff' });
    for (let i = 0; i < 7; i++) {
      const d = new THREE.Mesh(new THREE.CapsuleGeometry(0.008, 0.03, 2, 4), dropMat);
      d.userData.noInk = true;
      d.userData.x = (Math.random() - 0.5) * 0.3;
      d.userData.off = Math.random();
      c.add(d);
      this.drops.push(d);
    }
  }

  private clearCloud(): void {
    if (this.cloud) this.group.remove(this.cloud);
    this.cloud = null;
    this.drops = [];
  }

  private clearBuddies(): void {
    for (const b of this.buddies) this.group.remove(b.obj);
    this.buddies = [];
  }

  update(dt: number): void {
    // buddies: pop in with an overshoot, bounce with squash & stretch, pop out
    for (const b of this.buddies) {
      b.t += dt;
      const t = Math.max(0, b.t);
      const appear = Math.min(1, t / 0.25);
      const vanish = Math.min(1, Math.max(0, (b.life - t) / 0.3));
      const pop = backOut(appear) * vanish * b.scale;
      let hop = Math.abs(Math.sin(t * 8 + b.phase));
      let sq = 1 - (1 - hop) * 0.35; // squashed at the bottom of each hop
      const o = b.obj;
      o.rotation.set(0, 0, 0);
      switch (b.kind) {
        case 'ring': {
          const n = 8;
          const a = t * 2.2 + (b.phase / n) * Math.PI * 2;
          o.position.set(b.base.x + Math.cos(a) * 0.55, b.base.y + hop * 0.22, b.base.z + Math.sin(a) * 0.55);
          o.rotation.y = -a;
          o.rotation.z = Math.sin(t * 10 + b.phase) * 0.3;
          break;
        }
        case 'hop':
          o.position.set(b.base.x, b.base.y + hop * 0.3, b.base.z);
          o.rotation.z = Math.sin(t * 8 + b.phase) * 0.25;
          break;
        case 'flank':
          // the split pins wobble and lean away from each other
          hop = Math.abs(Math.sin(t * 5));
          sq = 1 - (1 - hop) * 0.2;
          o.position.set(b.base.x, b.base.y + hop * 0.08, b.base.z);
          o.rotation.z = (b.phase ? -1 : 1) * (0.25 + Math.sin(t * 6) * 0.15);
          break;
        case 'giggle':
          // laughing pin: shaking side to side and doubling over
          o.position.set(b.base.x, b.base.y + Math.abs(Math.sin(t * 18)) * 0.03, b.base.z);
          o.rotation.z = Math.sin(t * 22) * 0.18;
          o.rotation.x = 0.25 + Math.sin(t * 6) * 0.15;
          sq = 1 + Math.sin(t * 22) * 0.06;
          break;
        case 'ballHop': {
          // bouncing ball zig-zags across, squishing on every landing
          const x = Math.sin(t * 2.5) * 0.5;
          o.position.set(b.base.x + x, b.base.y + 0.12 + hop * 0.35, b.base.z);
          o.rotation.z -= dt * 8;
          sq = 1 - (1 - hop) * 0.45;
          break;
        }
      }
      o.scale.set(pop / Math.sqrt(sq), pop * sq, pop / Math.sqrt(sq));
    }
    const done = this.buddies.filter((b) => b.t > b.life);
    done.forEach((b) => this.group.remove(b.obj));
    this.buddies = this.buddies.filter((b) => b.t <= b.life);

    // stars
    for (const s of this.stars) {
      s.life -= dt;
      s.vel.y -= 6 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.z += s.spin * dt;
      s.mesh.scale.setScalar(Math.max(0, Math.min(1, s.life * 2)));
    }
    this.stars.filter((s) => s.life <= 0).forEach((s) => this.group.remove(s.mesh));
    this.stars = this.stars.filter((s) => s.life > 0);

    // rain cloud
    if (this.cloud) {
      this.cloudT -= dt;
      const c = this.cloud;
      const k = Math.min(1, (2.6 - this.cloudT) / 0.3) * Math.min(1, this.cloudT / 0.4);
      c.scale.set(k * (1 + Math.sin(this.cloudT * 9) * 0.05), k * (1 - Math.sin(this.cloudT * 9) * 0.05), k);
      for (const d of this.drops) {
        const u = ((2.6 - this.cloudT) * 1.6 + d.userData.off) % 1;
        d.position.set(d.userData.x, -0.08 - u * 0.6, 0);
        d.visible = u < 0.95;
      }
      if (this.cloudT <= 0) this.clearCloud();
    }
  }
}

function backOut(t: number): number {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}
