/**
 * Friends — every player gets a persistent friend code. While the hub is open we listen on
 * PeerJS id `jbf<code>` so friends can see us online and send party invites.
 */
import type { DataConnection, Peer as PeerType } from 'peerjs';
import { makeCode } from '../net/protocol.ts';

export interface Friend {
  code: string;
  name: string;
  online?: boolean;
  party?: string;
}

type FriendMsg =
  | { t: 'ping'; from: string; name: string }
  | { t: 'pong'; name: string; party: string }
  | { t: 'invite'; from: string; name: string; party: string };

export interface Invite {
  from: string;
  name: string;
  party: string;
}

const KEY_ME = 'jb.friendCode';
const KEY_LIST = 'jb.friends';
const PREFIX = 'jbf';

function load<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(k: string, v: unknown): void {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
}

export class Friends {
  readonly myCode: string;
  list: Friend[];
  onChange: () => void = () => {};
  onInvite: (i: Invite) => void = () => {};
  /** Supplies the current profile name and party code (empty if none). */
  status: () => { name: string; party: string } = () => ({ name: 'Player', party: '' });

  private peer: PeerType | null = null;
  private timer = 0;

  constructor() {
    let code = load<string>(KEY_ME, '');
    if (!code) {
      code = makeCode() + makeCode().slice(0, 2);
      save(KEY_ME, code);
    }
    this.myCode = code;
    this.list = load<Friend[]>(KEY_LIST, []).map((f) => ({ code: f.code, name: f.name }));
  }

  async start(): Promise<void> {
    const Peer = (await import('peerjs')).default;
    const peer = new Peer(PREFIX + this.myCode);
    this.peer = peer;
    peer.on('connection', (c) => this.onIncoming(c));
    peer.on('error', () => {});
    peer.on('open', () => this.refresh());
    this.timer = window.setInterval(() => this.refresh(), 15_000);
  }

  add(code: string, name: string): string | null {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length < 5) return 'That code looks too short';
    if (c === this.myCode) return "That's your own code!";
    if (this.list.some((f) => f.code === c)) return 'Already a friend';
    this.list.push({ code: c, name: name.trim() || 'Friend' });
    this.persist();
    this.refresh();
    return null;
  }

  remove(code: string): void {
    this.list = this.list.filter((f) => f.code !== code);
    this.persist();
  }

  invite(code: string): void {
    const s = this.status();
    if (!s.party) return;
    this.send(code, { t: 'invite', from: this.myCode, name: s.name, party: s.party });
  }

  refresh(): void {
    const s = this.status();
    for (const f of this.list) {
      this.send(f.code, { t: 'ping', from: this.myCode, name: s.name }, (reply) => {
        if (reply.t !== 'pong') return;
        f.online = true;
        f.name = reply.name || f.name;
        f.party = reply.party;
        this.persist();
        this.onChange();
      }, () => {
        f.online = false;
        f.party = '';
        this.onChange();
      });
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    this.peer?.destroy();
    this.peer = null;
  }

  private persist(): void {
    save(KEY_LIST, this.list.map((f) => ({ code: f.code, name: f.name })));
    this.onChange();
  }

  private onIncoming(c: DataConnection): void {
    c.on('data', (raw) => {
      const m = raw as FriendMsg;
      if (m?.t === 'ping') {
        const s = this.status();
        c.send({ t: 'pong', name: s.name, party: s.party } satisfies FriendMsg);
        // auto-add people who added us, so friendship is mutual
        if (!this.list.some((f) => f.code === m.from)) {
          this.list.push({ code: m.from, name: m.name, online: true });
          this.persist();
        }
      } else if (m?.t === 'invite') {
        this.onInvite({ from: m.from, name: m.name, party: m.party });
      }
    });
  }

  private send(code: string, m: FriendMsg, onReply?: (r: FriendMsg) => void, onFail?: () => void): void {
    const peer = this.peer;
    if (!peer || peer.disconnected) {
      onFail?.();
      return;
    }
    const c = peer.connect(PREFIX + code, { reliable: true });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (!ok) onFail?.();
      setTimeout(() => c.close(), 500);
    };
    const t = setTimeout(() => finish(false), 6000);
    c.on('open', () => {
      c.send(m);
      if (!onReply) {
        clearTimeout(t);
        finish(true);
      }
    });
    c.on('data', (r) => {
      clearTimeout(t);
      onReply?.(r as FriendMsg);
      finish(true);
    });
    c.on('error', () => {
      clearTimeout(t);
      finish(false);
    });
  }
}
