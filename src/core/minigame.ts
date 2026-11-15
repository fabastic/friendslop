import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Hud } from './hud.ts';
import type { Input } from './input.ts';
import type { Sfx } from './audio.ts';
import type { NetSession } from '../net/session.ts';

export interface GameContext {
  R: typeof RAPIER;
  renderer: THREE.WebGLRenderer;
  hud: Hud;
  input: Input;
  sfx: Sfx;
  /** Online room session (idle until the player creates/joins a room). */
  net: NetSession;
  /** Ask the host to restart / swap games. */
  requestRestart(): void;
}

export interface Minigame {
  readonly id: string;
  readonly title: string;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  init(ctx: GameContext): void;
  /** Fixed 60 Hz simulation step. */
  fixedUpdate(dt: number): void;
  /** Per-frame visual update; alpha = interpolation factor between the last two fixed steps. */
  update(dt: number, alpha: number): void;
  /** Must free every physics object, GPU resource and listener. */
  dispose(): void;
  /** Optional deterministic hooks for automated tests. */
  debug?: Record<string, unknown>;
}

export type MinigameFactory = () => Minigame;

export const registry = new Map<string, { title: string; create: MinigameFactory }>();

export function registerGame(id: string, title: string, create: MinigameFactory): void {
  registry.set(id, { title, create });
}
