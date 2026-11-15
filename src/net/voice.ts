/**
 * VoiceLink — optional push-to-talk-free voice chat over the same PeerJS mesh.
 *
 * Every peer with the mic on calls every other peer with a WebRTC audio track;
 * peers without a mic answer receive-only. Muting just disables the local tracks,
 * so the calls stay warm and unmuting is instant.
 */
import type { MediaConnection, Peer as PeerType } from 'peerjs';

export class VoiceLink {
  micOn = false;
  private stream: MediaStream | null = null;
  private calls = new Map<string, MediaConnection>();
  private audios = new Map<string, HTMLAudioElement>();
  private unlock: (() => void) | null = null;

  private getPeer: () => PeerType | null;
  private peerIds: () => string[];

  constructor(getPeer: () => PeerType | null, peerIds: () => string[]) {
    this.getPeer = getPeer;
    this.peerIds = peerIds;
  }

  async setMic(on: boolean): Promise<boolean> {
    if (on) {
      if (!this.stream) {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
        } catch {
          return false; // permission denied / no device
        }
      }
      this.stream.getTracks().forEach((t) => (t.enabled = true));
      this.micOn = true;
      for (const id of this.peerIds()) this.call(id);
      this.armUnlock();
      return true;
    }
    this.micOn = false;
    this.stream?.getTracks().forEach((t) => (t.enabled = false));
    return true;
  }

  /** A new peer appeared and we have a mic: reach out. */
  attach(id: string): void {
    if (this.micOn) this.call(id);
  }

  detach(id: string): void {
    const call = this.calls.get(id);
    if (call) {
      try {
        call.close();
      } catch {
        /* already gone */
      }
      this.calls.delete(id);
    }
    this.removeAudio(id);
  }

  answer(call: MediaConnection): void {
    const prev = this.calls.get(call.peer);
    if (prev && prev !== call) {
      try {
        prev.close();
      } catch {
        /* replacing it anyway */
      }
    }
    try {
      call.answer(this.stream ?? undefined); // no mic → receive-only
    } catch {
      return;
    }
    this.bind(call.peer, call);
  }

  private call(id: string): void {
    const peer = this.getPeer();
    if (!peer || !this.stream) return;
    const existing = this.calls.get(id);
    if (existing && existing.open) return; // already talking
    try {
      const call = peer.call(id, this.stream);
      if (call) this.bind(id, call);
    } catch {
      /* peer gone; their close handler cleans up */
    }
  }

  private bind(id: string, call: MediaConnection): void {
    this.calls.set(id, call);
    call.on('stream', (remote: MediaStream) => this.attachAudio(id, remote));
    call.on('close', () => {
      if (this.calls.get(id) === call) this.calls.delete(id);
      this.removeAudio(id);
    });
    call.on('error', () => {
      if (this.calls.get(id) === call) this.calls.delete(id);
    });
  }

  private attachAudio(id: string, stream: MediaStream): void {
    let el = this.audios.get(id);
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px';
      document.body.appendChild(el);
      this.audios.set(id, el);
    }
    el.srcObject = stream;
    el.play().catch(() => this.armUnlock()); // autoplay policy: retry after the next gesture
  }

  /** Browsers block audio until the user has interacted with the page. */
  private armUnlock(): void {
    if (this.unlock) return;
    const fn = (): void => {
      document.removeEventListener('pointerdown', fn);
      document.removeEventListener('keydown', fn);
      this.unlock = null;
      for (const el of this.audios.values()) el.play().catch(() => undefined);
    };
    this.unlock = fn;
    document.addEventListener('pointerdown', fn);
    document.addEventListener('keydown', fn);
  }

  private removeAudio(id: string): void {
    const el = this.audios.get(id);
    if (!el) return;
    el.srcObject = null;
    el.remove();
    this.audios.delete(id);
  }

  destroy(): void {
    if (this.unlock) {
      document.removeEventListener('pointerdown', this.unlock);
      document.removeEventListener('keydown', this.unlock);
      this.unlock = null;
    }
    for (const call of this.calls.values()) {
      try {
        call.close();
      } catch {
        /* gone */
      }
    }
    this.calls.clear();
    for (const id of [...this.audios.keys()]) this.removeAudio(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.micOn = false;
  }
}
