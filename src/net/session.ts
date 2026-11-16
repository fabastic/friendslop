/**
 * NetSession — room codes + a full-mesh of PeerJS data channels.
 *
 * Topology: the host owns the room code (`jbXXXXX`); guests dial the host, and every
 * peer also dials every other peer (the peer with the lexicographically smaller id
 * dials, so a pair never opens two channels between itself). Game-state messages go
 * straight to peers; chat is relayed through the host so late joiners get history.
 */
import type { DataConnection, Peer as PeerType, MediaConnection } from 'peerjs';
import {
  CHAT_HISTORY, isNetMsg, makeCode, MAX_PLAYERS,
  type ChatLine, type LobbyPlayer, type NetMsg, type StartConfig,
} from './protocol.ts';
import { VoiceLink } from './voice.ts';
import { PEER_OPTS } from './ice.ts';

export type SessionEvent =
  | { e: 'lobby' } // players / running / chat changed
  | { e: 'msg'; m: NetMsg } // a game message for the app
  | { e: 'gone'; player: LobbyPlayer } // host only: someone dropped out (app decides what it means)
  | { e: 'error'; text: string }
  | { e: 'host-lost' } // the room dissolved under us
  | { e: 'closed' }; // we left on purpose

type Handler = (ev: SessionEvent) => void;

const HOST_PREFIX = 'jb';
const JOIN_TIMEOUT_MS = 20_000; // TURN-relayed links can take a while to come up

export class NetSession {
  active = false;
  isHost = false;
  code = '';
  /** True from the host's startGame() until the room is left (new joiners wait for the next game). */
  gameRunning = false;
  chatOpen = false;
  myPeerId = '';
  mySeat = -1;
  players: LobbyPlayer[] = [];
  chat: ChatLine[] = [];

  private peer: PeerType | null = null;
  private conns = new Map<string, DataConnection>();
  private handlers = new Set<Handler>();
  private hostConn: DataConnection | null = null;
  private voice: VoiceLink | null = null;
  private dialing = new Set<string>();
  private timer = 0;
  private gotLobby = false;

  // ---------------------------------------------------------------- events
  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => void this.handlers.delete(h);
  }

  private emit(ev: SessionEvent): void {
    for (const h of [...this.handlers]) {
      try {
        h(ev);
      } catch (e) {
        console.error('session handler', e);
      }
    }
  }

  // ---------------------------------------------------------------- lifecycle
  /** Create a room; resolves once the peer is listening. */
  async host(profile: { name: string; species: string; color: string }): Promise<void> {
    if (this.active) this.teardown();
    const Peer = (await import('peerjs')).default;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeCode();
      const peer = new Peer(HOST_PREFIX + code, PEER_OPTS);
      const ok = await new Promise<boolean>((resolve) => {
        const onOpen = () => {
          cleanup();
          resolve(true);
        };
        const onErr = (err: Error & { type?: string }) => {
          cleanup();
          if (err?.type === 'unavailable-id') resolve(false); // code collision: try another
          else {
            this.fail(`Could not create a room (${err?.type ?? 'error'})`);
            resolve(false);
          }
        };
        const cleanup = () => {
          peer.off('open', onOpen);
          peer.off('error', onErr);
        };
        peer.on('open', onOpen);
        peer.on('error', onErr);
      });
      if (!ok) {
        peer.destroy();
        if (attempt === 4) return;
        continue;
      }
      this.setupPeer(peer, code, true);
      this.myPeerId = peer.id;
      this.players = [{ seat: 0, peerId: peer.id, ...profile }];
      this.mySeat = 0;
      this.chat = [];
      this.gotLobby = true;
      this.voice = new VoiceLink(() => this.peer, () => [...this.conns.keys()]);
      this.emit({ e: 'lobby' });
      return;
    }
  }

  /** Join a room by code; resolves (with active=true) once we're in the lobby. */
  async join(code: string, profile: { name: string; species: string; color: string }): Promise<void> {
    if (this.active) this.teardown();
    this.gotLobby = false;
    const Peer = (await import('peerjs')).default;
    const peer = new Peer(PEER_OPTS);
    const ok = await new Promise<boolean>((resolve) => {
      const onOpen = () => {
        cleanup();
        resolve(true);
      };
      const onErr = (err: Error & { type?: string }) => {
        cleanup();
        this.fail(`Could not reach the server (${err?.type ?? 'error'})`);
        resolve(false);
      };
      const cleanup = () => {
        peer.off('open', onOpen);
        peer.off('error', onErr);
      };
      peer.on('open', onOpen);
      peer.on('error', onErr);
    });
    if (!ok) {
      peer.destroy();
      return;
    }
    this.setupPeer(peer, code, false);
    this.myPeerId = peer.id;

    const conn = peer.connect(HOST_PREFIX + code, { reliable: true });
    const dialled = await new Promise<boolean>((resolve) => {
      const onOpen = () => {
        cleanup();
        resolve(true);
      };
      const onErr = () => {
        cleanup();
        this.fail(`Could not join room ${code}`);
        resolve(false);
      };
      const cleanup = () => {
        conn.off('open', onOpen);
        conn.off('error', onErr);
      };
      conn.on('open', onOpen);
      conn.on('error', onErr);
      window.setTimeout(() => {
        if (!conn.open) {
          cleanup();
          this.fail(`Room ${code} not found — check the code and try again`);
          resolve(false);
        }
      }, JOIN_TIMEOUT_MS);
    });
    if (!dialled) {
      peer.destroy();
      return;
    }
    this.hostConn = conn;
    this.wire(conn);
    conn.send({ t: 'hello', ...profile } satisfies NetMsg);
    // the host answers with a lobby snapshot; a silent host means we're not really in
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.gotLobby) this.fail(`Room ${code} did not answer`);
    }, JOIN_TIMEOUT_MS);
  }

  /** Back out of the room without drama (no 'closed' echo). */
  private teardown(): void {
    window.clearTimeout(this.timer);
    for (const c of this.conns.values()) {
      try {
        c.close();
      } catch {
        /* already gone */
      }
    }
    this.conns.clear();
    this.hostConn = null;
    this.dialing.clear();
    try {
      this.peer?.destroy();
    } catch {
      /* already gone */
    }
    this.peer = null;
    this.voice?.destroy();
    this.voice = null;
    this.active = false;
    this.isHost = false;
    this.gameRunning = false;
    this.chatOpen = false;
    this.code = '';
    this.mySeat = -1;
    this.players = [];
    this.chat = [];
    this.gotLobby = false;
  }

  /** Leave the room: callers follow 'closed' with their own UI (back to the setup menu). */
  leave(): void {
    const was = this.active;
    this.teardown();
    if (was) this.emit({ e: 'closed' });
  }

  private fail(text: string): void {
    this.teardown();
    this.emit({ e: 'error', text });
  }

  private setupPeer(peer: PeerType, code: string, host: boolean): void {
    this.peer = peer;
    this.active = true;
    this.isHost = host;
    this.code = code;
    peer.on('connection', (conn) => this.wire(conn));
    peer.on('call', (call: MediaConnection) => this.voice?.answer(call));
    peer.on('disconnected', () => {
      // signaling blip: reattach; live data channels don't depend on it
      try {
        peer.reconnect();
      } catch {
        /* give up quietly */
      }
    });
    peer.on('error', (err: Error & { type?: string }) => {
      if (!this.active) return;
      if (err?.type === 'peer-unreachable' || err?.type === 'network' || err?.type === 'server-error') {
        if (this.isHost) this.fail('Lost connection to the signaling server');
        else this.emit({ e: 'host-lost' });
      }
    });
  }

  // ---------------------------------------------------------------- mesh + routing
  private wire(conn: DataConnection): void {
    const existing = this.conns.get(conn.peer);
    if (existing && existing !== conn) {
      // dedupe: keep whichever channel opened first (the dial rule makes this rare)
      if (existing.open || !conn.open) {
        if (conn.open) {
          try {
            conn.close();
          } catch {
            /* keep existing */
          }
        }
        if (existing.open) return;
      }
    }
    this.conns.set(conn.peer, conn);
    const onReady = () => {
      if (this.conns.get(conn.peer) !== conn) return; // superseded
      if (this.isHost) this.broadcastLobby();
      else this.dialRoster();
      this.voice?.attach(conn.peer);
    };
    conn.on('open', onReady);
    conn.on('data', (raw) => this.onData(conn, raw));
    conn.on('close', () => this.onGone(conn));
    conn.on('error', () => this.onGone(conn));
    if (conn.open) onReady();
  }

  private onData(conn: DataConnection, raw: unknown): void {
    if (!isNetMsg(raw)) return;
    const m = raw;
    if (this.isHost) {
      if (m.t === 'hello') {
        const p = this.players.find((x) => x.peerId === conn.peer);
        if (p) {
          p.name = m.name;
          p.species = m.species;
          p.color = m.color;
        } else if (this.players.length < MAX_PLAYERS) {
          this.players.push({ seat: this.players.length, peerId: conn.peer, name: m.name, species: m.species, color: m.color });
        } else {
          conn.close(); // room full — the guest's join timer reports it
          return;
        }
        this.broadcastLobby();
        return;
      }
      if (m.t === 'chat') {
        this.pushChat(m.seat, m.text);
        this.send({ t: 'chat', seat: m.seat, text: m.text });
        this.emit({ e: 'msg', m: { t: 'chat', seat: m.seat, text: m.text } });
        return;
      }
      if (m.t === 'lobby' || m.t === 'start' || m.t === 'again' || m.t === 'continue' || m.t === 'remove') return; // host owns these
      this.emit({ e: 'msg', m });
      return;
    }
    // guest side
    if (m.t === 'lobby') {
      this.players = m.players;
      this.chat = m.chat;
      this.gameRunning = m.running;
      this.mySeat = this.players.find((p) => p.peerId === this.myPeerId)?.seat ?? -1;
      this.gotLobby = true;
      window.clearTimeout(this.timer);
      this.emit({ e: 'lobby' });
      this.dialRoster();
      return;
    }
    if (m.t === 'hello') return;
    if (m.t === 'chat') {
      this.pushChat(m.seat, m.text); // keep the guest's history in step (the hub reads it)
      this.emit({ e: 'lobby' });
    }
    if (m.t === 'start' || m.t === 'again') this.gameRunning = true;
    this.emit({ e: 'msg', m });
  }

  /** Full-mesh upkeep: dial anyone we should dial and aren't connected to. */
  private dialRoster(): void {
    if (!this.peer || this.isHost) return;
    for (const p of this.players) {
      if (p.peerId === this.myPeerId) continue;
      if (p.peerId === HOST_PREFIX + this.code) continue; // the host link is hostConn
      if (this.conns.get(p.peerId)?.open) continue;
      if (this.dialing.has(p.peerId)) continue;
      // deterministic: the smaller id dials, so a pair only ever opens one channel
      if (!(this.myPeerId < p.peerId)) continue;
      this.dialing.add(p.peerId);
      try {
        const conn = this.peer.connect(p.peerId, { reliable: true });
        const done = () => this.dialing.delete(p.peerId);
        conn.on('open', done);
        conn.on('close', done);
        conn.on('error', done);
        this.wire(conn);
      } catch {
        this.dialing.delete(p.peerId);
      }
    }
  }

  private onGone(conn: DataConnection): void {
    const peerId = conn.peer;
    // ignore stale closes from a channel we've already replaced
    if (this.conns.get(peerId) !== conn) return;
    this.conns.delete(peerId);
    this.dialing.delete(peerId);
    this.voice?.detach(peerId);
    if (this.isHost) {
      const p = this.players.find((x) => x.peerId === peerId);
      if (!p) return;
      this.players = this.players.filter((x) => x.peerId !== peerId);
      this.reseat();
      this.broadcastLobby();
      this.emit({ e: 'gone', player: p });
      return;
    }
    if (peerId === HOST_PREFIX + this.code) {
      this.emit({ e: 'host-lost' });
      return;
    }
    // mesh link to a peer dropped: try again while they're still in the room
    if (this.players.some((p) => p.peerId === peerId)) window.setTimeout(() => this.dialRoster(), 800);
  }

  private reseat(): void {
    this.players.forEach((p, i) => (p.seat = i));
    this.mySeat = this.players.find((p) => p.peerId === this.myPeerId)?.seat ?? this.mySeat;
  }

  // ---------------------------------------------------------------- outgoing
  /** Broadcast a game message to every other peer (apply it locally yourself first). */
  send(m: NetMsg): void {
    for (const c of this.conns.values()) {
      if (c.open) {
        try {
          c.send(m);
        } catch {
          /* the close handler will clean up */
        }
      }
    }
  }

  /** Send only to the host (used by guests for chat). */
  sendToHost(m: NetMsg): void {
    if (this.isHost) {
      this.onData({ peer: this.myPeerId } as DataConnection, m);
      return;
    }
    if (this.hostConn?.open) this.hostConn.send(m);
  }

  /** Update my name/animal/colour: host rebroadcasts the lobby, guests ping the host. */
  updateProfile(profile: { name: string; species: string; color: string }): void {
    if (!this.active) return;
    if (this.isHost) {
      const me = this.players.find((p) => p.peerId === this.myPeerId);
      if (me) Object.assign(me, profile);
      this.broadcastLobby();
    } else {
      this.sendToHost({ t: 'hello', ...profile });
    }
  }

  /** Host: push the current lobby (players + running + chat history) to everyone. */
  broadcastLobby(): void {
    if (!this.isHost) return;
    this.send({ t: 'lobby', players: this.players, running: this.gameRunning, chat: this.chat.slice(-CHAT_HISTORY) });
    this.emit({ e: 'lobby' });
  }

  private pushChat(seat: number, text: string): void {
    const p = this.players.find((x) => x.seat === seat);
    this.chat.push({ seat, name: p?.name ?? '?', text });
    if (this.chat.length > CHAT_HISTORY) this.chat.splice(0, this.chat.length - CHAT_HISTORY);
  }

  /** Chat: guests hand it to the host, who stamps history and fans it out (incl. back to the sender). */
  sendChat(seat: number, text: string): void {
    const trimmed = text.trim().slice(0, 140);
    if (!trimmed || !this.active) return;
    if (this.isHost) {
      this.pushChat(seat, trimmed);
      this.send({ t: 'chat', seat, text: trimmed });
      this.emit({ e: 'msg', m: { t: 'chat', seat, text: trimmed } });
    } else {
      this.sendToHost({ t: 'chat', seat, text: trimmed });
    }
  }

  // ---------------------------------------------------------------- voice
  async setMic(on: boolean): Promise<boolean> {
    if (!this.active) return false;
    if (!this.voice) this.voice = new VoiceLink(() => this.peer, () => [...this.conns.keys()]);
    return this.voice.setMic(on);
  }

  get micOn(): boolean {
    return this.voice?.micOn ?? false;
  }

  /** Line-up in seat order — what start/again messages carry. */
  configs(): StartConfig[] {
    return this.players.map((p) => ({ name: p.name, species: p.species, color: p.color }));
  }

  playerName(seat: number): string {
    return this.players.find((p) => p.seat === seat)?.name ?? `Player ${seat + 1}`;
  }
}
