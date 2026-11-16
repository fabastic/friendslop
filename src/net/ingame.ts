/**
 * In-match online layer shared by every game: the room bar (code, chat, emotes, mic) plus emotes
 * that pop up over the sender's character. Does nothing when the player isn't in a party.
 */
import * as THREE from 'three';
import type { GameContext } from '../core/minigame.ts';
import { NetHud } from './ui.ts';
import './ingame.css';

interface Floater {
  el: HTMLElement;
  pid: string;
  age: number;
}

export interface InGameNet {
  /** call every rendered frame */
  update(dt: number, camera: THREE.Camera): void;
  dispose(): void;
}

/**
 * `anchor(pid)` returns the world position above a player's head (or null if not visible).
 * Keys: T opens chat, 1–8 send an emote.
 */
export function attachInGameNet(ctx: GameContext, anchor: (pid: string) => THREE.Vector3 | null): InGameNet {
  const net = ctx.net;
  if (!net.active) return { update() {}, dispose() {} };

  const floaters: Floater[] = [];
  const spawn = (pid: string, id: number) => {
    const el = hud.floatEmote(id);
    floaters.push({ el, pid, age: 0 });
    ctx.sfx.pop();
  };
  const sendEmote = (id: number) => {
    net.send({ t: 'emote', seat: net.mySeat, id });
    spawn(net.myPeerId, id);
  };
  const hud = new NetHud(ctx.hud, net, { onEmote: sendEmote });
  const off = net.on((ev) => {
    if (ev.e !== 'msg' || ev.m.t !== 'emote') return;
    const seat = ev.m.seat;
    const p = net.players.find((x) => x.seat === seat);
    if (p) spawn(p.peerId, ev.m.id);
  });
  const keys = (e: KeyboardEvent) => {
    if (hud.isChatOpen()) return;
    if (e.code === 'KeyT') {
      e.preventDefault();
      hud.setChatOpen(true);
    } else if (/^Digit[1-8]$/.test(e.code)) {
      sendEmote(Number(e.code.slice(5)) - 1);
    }
  };
  window.addEventListener('keydown', keys);

  const v = new THREE.Vector3();
  return {
    update(dt, camera) {
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.age += dt;
        const at = anchor(f.pid);
        if (f.age > 2.2 || !at) {
          f.el.remove();
          floaters.splice(i, 1);
          continue;
        }
        v.copy(at).project(camera);
        const rise = f.age * 40;
        f.el.style.opacity = String(Math.min(1, (2.2 - f.age) * 2));
        f.el.style.display = v.z < 1 ? '' : 'none';
        f.el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight - rise}px) translate(-50%, -100%) scale(${Math.min(1, f.age * 6)})`;
      }
    },
    dispose() {
      window.removeEventListener('keydown', keys);
      off();
      floaters.forEach((f) => f.el.remove());
      hud.destroy();
    },
  };
}
