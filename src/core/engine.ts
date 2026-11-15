import * as THREE from 'three';
import type { Minigame } from './minigame.ts';
import { isSharedTexture } from './toon.ts';
import { setInkResolution } from './ink.ts';

export const FIXED_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

/** Owns the renderer and runs a fixed-timestep loop for the active minigame. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  game: Minigame | null = null;
  private acc = 0;
  private last = 0;
  private running = false;
  private raf = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in this three.js version
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  setGame(game: Minigame | null): void {
    this.game = game;
    this.acc = 0;
    this.onResize();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Advance one rendered frame of real time. */
  frame(dt: number): void {
    const g = this.game;
    if (!g) return;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      g.fixedUpdate(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
    g.update(dt, this.acc / FIXED_DT);
    this.render();
  }

  /** Deterministic stepping for tests: n fixed steps then one render. */
  step(n: number): void {
    const g = this.game;
    if (!g) return;
    for (let i = 0; i < n; i++) {
      g.fixedUpdate(FIXED_DT);
      g.update(FIXED_DT, 1);
    }
    this.render();
  }

  render(): void {
    const g = this.game;
    if (g) this.renderer.render(g.scene, g.camera);
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    setInkResolution(w * pr, h * pr);
    const cam = this.game?.camera;
    if (cam) {
      cam.aspect = w / h;
      // keep the lane framed on tall/narrow screens
      cam.fov = w / h < 0.8 ? 70 : 50;
      cam.updateProjectionMatrix();
    }
  };

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}

/** Dispose every geometry, material and texture under an object. */
export function disposeObject(root: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.Light) o.dispose(); // frees shadow map render targets
    if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose(); // frees bone textures
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) {
      const list = Array.isArray(m.material) ? m.material : [m.material];
      list.forEach((x) => mats.add(x));
    }
  });
  mats.forEach((mat) => {
    for (const v of Object.values(mat)) {
      if (v instanceof THREE.Texture && !isSharedTexture(v)) v.dispose();
    }
    mat.dispose();
  });
}
