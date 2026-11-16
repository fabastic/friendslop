export interface FlickSample {
  x: number;
  y: number;
  t: number;
}

export interface Flick {
  /** Screen-space velocity of the release segment, px/s (y negative = upward). */
  vx: number;
  vy: number;
  /** Total stroke offset from pointer-down to release, px. */
  dx: number;
  dy: number;
  /** Lateral velocity change across the stroke (curve), px/s. */
  curve: number;
}

type FlickHandler = (f: Flick) => void;
type DragHandler = (samples: readonly FlickSample[]) => void;

/** Pointer drag/flick + keyboard state. */
export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  private samples: FlickSample[] = [];
  private down = false;
  private flickHandlers: FlickHandler[] = [];
  private dragHandlers: DragHandler[] = [];
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  get dragging(): boolean {
    return this.down;
  }

  /** True once per key press (consumed). */
  wasPressed(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  /** Virtual buttons (touch controls): hold/release a key code as if typed. */
  setVirtual(code: string, down: boolean): void {
    if (down && !this.keys.has(code)) this.pressed.add(code);
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  /** Discard unconsumed presses so they can't fire in a later phase. */
  endFrame(): void {
    this.pressed.clear();
  }

  onFlick(h: FlickHandler): () => void {
    this.flickHandlers.push(h);
    return () => (this.flickHandlers = this.flickHandlers.filter((x) => x !== h));
  }

  onDrag(h: DragHandler): () => void {
    this.dragHandlers.push(h);
    return () => (this.dragHandlers = this.dragHandlers.filter((x) => x !== h));
  }

  clearHandlers(): void {
    this.flickHandlers = [];
    this.dragHandlers = [];
    this.pressed.clear();
  }

  private onDown = (e: PointerEvent): void => {
    this.down = true;
    this.samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    this.dragHandlers.forEach((h) => h(this.samples));
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.down) return;
    this.samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (this.samples.length > 120) this.samples.shift();
    this.dragHandlers.forEach((h) => h(this.samples));
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.down) return;
    this.down = false;
    const now = performance.now();
    this.samples.push({ x: e.clientX, y: e.clientY, t: now });
    const f = computeFlick(this.samples);
    this.samples = [];
    this.dragHandlers.forEach((h) => h(this.samples));
    if (f) this.flickHandlers.forEach((h) => h(f));
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!e.repeat) this.pressed.add(e.code);
    this.keys.add(e.code);
    if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.down = false;
  };

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

/** Velocity over the last ~100 ms, plus whole-stroke offset and curvature. */
export function computeFlick(s: readonly FlickSample[]): Flick | null {
  if (s.length < 2) return null;
  const end = s[s.length - 1];
  let i = s.length - 2;
  while (i > 0 && end.t - s[i].t < 100) i--;
  const a = s[i];
  const dt = Math.max((end.t - a.t) / 1000, 0.016);
  const vx = (end.x - a.x) / dt;
  const vy = (end.y - a.y) / dt;

  // find the lowest point (max y) of the stroke = start of the forward swing
  let lowIdx = 0;
  for (let k = 1; k < s.length; k++) if (s[k].y >= s[lowIdx].y) lowIdx = k;
  const low = s[lowIdx];
  const swingDt = Math.max((end.t - low.t) / 1000, 0.016);
  const swingVx = (end.x - low.x) / swingDt;
  return { vx, vy, dx: end.x - s[0].x, dy: end.y - s[0].y, curve: vx - swingVx };
}
