import type { Input } from '../../core/input.ts';
import './touch.css';

const DEAD_ZONE = 0.3;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** On-screen joystick + buttons for phones and tablets. */
export class TouchControls {
  private readonly input: Input;
  private root: HTMLDivElement | null = null;
  private knob: HTMLDivElement | null = null;
  private readonly ac = new AbortController();
  private readonly joystickKeys = new Set<string>();
  private readonly buttonKeys = new Set<string>();
  private stickPointer: number | null = null;
  private stickCx = 0;
  private stickCy = 0;
  private stickRadius = 1;
  private disposed = false;

  constructor(parent: HTMLElement, input: Input) {
    this.input = input;

    const coarse =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    const touch = 'ontouchstart' in window;
    if (!coarse && !touch) return;

    const root = document.createElement('div');
    root.className = 'pk-touch';

    const base = document.createElement('div');
    base.className = 'pk-touch-stick';
    base.setAttribute('aria-hidden', 'true');

    const knob = document.createElement('div');
    knob.className = 'pk-touch-knob';
    base.appendChild(knob);
    this.knob = knob;

    const pad = document.createElement('div');
    pad.className = 'pk-touch-pad';

    const colLeft = document.createElement('div');
    colLeft.className = 'pk-touch-col';
    colLeft.append(
      this.makeButton('Boost', 'pk-touch-small', 'KeyE'),
      this.makeButton('\u21BA', 'pk-touch-small', 'KeyR', 'Respawn'),
    );

    const colRight = document.createElement('div');
    colRight.className = 'pk-touch-col';
    colRight.append(
      this.makeButton('Jump', 'pk-touch-jump', 'Space'),
      this.makeButton('Climb', 'pk-touch-climb', 'ShiftLeft'),
    );

    pad.append(colLeft, colRight);
    root.append(base, pad);
    this.root = root;

    const signal = this.ac.signal;

    base.addEventListener('pointerdown', (e) => this.onStickDown(e, base), { signal });
    base.addEventListener('pointermove', (e) => this.onStickMove(e), { signal });
    base.addEventListener('pointerup', (e) => this.onStickUp(e), { signal });
    base.addEventListener('pointercancel', (e) => this.onStickUp(e), { signal });

    parent.appendChild(root);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseAll();
    this.ac.abort();
    this.root?.remove();
    this.root = null;
    this.knob = null;
  }

  private makeButton(label: string, cls: string, code: string, aria?: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pk-touch-btn ${cls}`;
    btn.textContent = label;
    btn.setAttribute('aria-label', aria ?? label);
    const signal = this.ac.signal;

    btn.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        btn.classList.add('pressed');
        if (!this.buttonKeys.has(code)) {
          this.buttonKeys.add(code);
          this.input.setVirtual(code, true);
        }
      },
      { signal },
    );

    const release = (): void => {
      btn.classList.remove('pressed');
      if (this.buttonKeys.delete(code)) this.input.setVirtual(code, false);
    };
    btn.addEventListener('pointerup', release, { signal });
    btn.addEventListener('pointercancel', release, { signal });
    btn.addEventListener('pointerleave', release, { signal });

    return btn;
  }

  private onStickDown(e: PointerEvent, base: HTMLElement): void {
    if (this.stickPointer !== null) return;
    e.preventDefault();
    this.stickPointer = e.pointerId;
    const rect = base.getBoundingClientRect();
    this.stickCx = rect.left + rect.width / 2;
    this.stickCy = rect.top + rect.height / 2;
    this.stickRadius = Math.max(rect.width / 2, 1);
    base.setPointerCapture(e.pointerId);
    this.moveStick(e.clientX, e.clientY);
  }

  private onStickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickPointer) return;
    e.preventDefault();
    this.moveStick(e.clientX, e.clientY);
  }

  private onStickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.releaseStick();
  }

  private moveStick(clientX: number, clientY: number): void {
    const dx = clientX - this.stickCx;
    const dy = clientY - this.stickCy;
    const dist = Math.hypot(dx, dy);
    const k = dist > this.stickRadius ? this.stickRadius / dist : 1;
    const ox = dx * k;
    const oy = dy * k;

    if (this.knob) {
      this.knob.style.transform = `translate(-50%, -50%) translate(${ox}px, ${oy}px)`;
    }

    const nx = clamp(dx / this.stickRadius, -1, 1);
    const ny = clamp(dy / this.stickRadius, -1, 1);
    this.setJoystickKey('KeyW', ny < -DEAD_ZONE);
    this.setJoystickKey('KeyS', ny > DEAD_ZONE);
    this.setJoystickKey('KeyA', nx < -DEAD_ZONE);
    this.setJoystickKey('KeyD', nx > DEAD_ZONE);
  }

  private setJoystickKey(code: string, down: boolean): void {
    if (down === this.joystickKeys.has(code)) return;
    if (down) {
      this.joystickKeys.add(code);
      this.input.setVirtual(code, true);
    } else {
      this.joystickKeys.delete(code);
      this.input.setVirtual(code, false);
    }
  }

  private releaseStick(): void {
    this.joystickKeys.forEach((code) => this.input.setVirtual(code, false));
    this.joystickKeys.clear();
    if (this.knob) this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private releaseAll(): void {
    this.releaseStick();
    this.buttonKeys.forEach((code) => this.input.setVirtual(code, false));
    this.buttonKeys.clear();
  }
}
