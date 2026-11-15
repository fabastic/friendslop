/**
 * Online UI: the room lobby (create/join by code, profiles, chat) and the in-game
 * net HUD (room code, chat, emote wheel, mic toggle). Pure DOM, styled in style.css.
 */
import type { Hud } from '../core/hud.ts';
import type { NetSession, SessionEvent } from './session.ts';
import { CHAT_MAX, EMOTES, normalizeCode, type StartConfig } from './protocol.ts';
import { JELLY_COLORS, SPECIES } from '../characters/jellyfolk.ts';

function profileOf(session: NetSession): { name: string; species: string; color: string } {
  const me = session.players.find((p) => p.peerId === session.myPeerId);
  return { name: me?.name ?? 'Player', species: me?.species ?? 'cat', color: me?.color ?? JELLY_COLORS[0] };
}

// ------------------------------------------------------------------ chat
/** Message feed + input, shared by the lobby and the in-game HUD. */
export class ChatBox {
  readonly root: HTMLElement;
  private feed!: HTMLElement;
  private row!: HTMLElement;
  private input!: HTMLInputElement;
  private unsub: () => void;
  private openState = false;
  private session: NetSession;

  constructor(hud: Hud, parent: HTMLElement, session: NetSession) {
    this.session = session;
    this.root = hud.el('div', 'chat', parent);
    this.feed = hud.el('div', 'chat-feed', this.root);
    this.row = hud.el('div', 'chat-row', this.root);
    this.input = hud.el('input', 'chat-input', this.row) as HTMLInputElement;
    this.input.maxLength = CHAT_MAX;
    this.input.placeholder = 'Say something…';
    const send = hud.el('button', 'chat-send', this.row);
    send.textContent = 'Send';
    send.onclick = () => this.submit();
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.submit();
      if (e.key === 'Escape') this.close();
    });
    this.input.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.unsub = session.on((ev) => {
      if (ev.e === 'lobby' || (ev.e === 'msg' && ev.m.t === 'chat')) this.refresh();
    });
    this.refresh();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    if (this.openState) return;
    this.openState = true;
    this.session.chatOpen = true;
    this.root.classList.add('open');
    this.input.focus();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.session.chatOpen = false;
    this.root.classList.remove('open');
    this.input.blur();
    this.input.value = '';
  }

  private submit(): void {
    const text = this.input.value;
    this.input.value = '';
    this.session.sendChat(this.session.mySeat, text);
    this.input.focus();
  }

  refresh(): void {
    const atBottom = true;
    this.feed.innerHTML = this.session.chat
      .slice(-6)
      .map((c) => {
        const p = this.session.players.find((x) => x.seat === c.seat);
        const col = p?.color ?? 'var(--ink)';
        const safe = c.text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
        return `<div class="chat-line" style="--pc:${col}"><b>${escape(c.name)}</b>${safe}</div>`;
      })
      .join('');
    if (atBottom) this.feed.scrollTop = this.feed.scrollHeight;
  }

  destroy(): void {
    this.close();
    this.unsub();
    this.root.remove();
  }
}

// ------------------------------------------------------------------ lobby
export interface LobbyCallbacks {
  /** Host pressed Start (or Play again from the final board): begin with this line-up. */
  onStart: (configs: StartConfig[]) => void;
  /** Back to the local setup menu (also called after leaving). */
  onLeave: () => void;
}

/** Full-screen room UI shown between the setup menu and the game. */
export class LobbyUI {
  private root: HTMLElement;
  private card!: HTMLElement;
  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private errEl!: HTMLElement;
  private chat: ChatBox | null = null;
  private unsub: () => void;
  private destroyed = false;
  private mode: 'entry' | 'connecting' | 'lobby' = 'entry';
  private entryName = 'Player 1';
  private entryCode = '';
  private hud: Hud;
  private session: NetSession;
  private cb: LobbyCallbacks;

  constructor(hud: Hud, session: NetSession, cb: LobbyCallbacks) {
    this.hud = hud;
    this.session = session;
    this.cb = cb;
    this.root = hud.el('div', 'overlay online');
    this.card = hud.el('div', 'card', this.root);
    this.unsub = session.on((ev) => this.onSession(ev));
    this.renderEntry();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsub();
    this.chat?.destroy();
    this.root.remove();
  }

  private onSession(ev: SessionEvent): void {
    if (this.destroyed) return;
    if (ev.e === 'lobby') {
      if (this.session.active) {
        if (this.mode !== 'lobby') this.renderLobby();
        else this.refreshList();
      }
      return;
    }
    if (ev.e === 'error') {
      if (this.mode === 'lobby' && this.session.active) this.showError(ev.text);
      else this.renderEntry(ev.text);
      return;
    }
    if (ev.e === 'host-lost') {
      if (this.session.active) this.renderEntry('The host left the room');
      this.session.leave();
      return;
    }
    if (ev.e === 'closed') {
      this.destroy();
      this.cb.onLeave();
    }
  }

  // ------------------------------------------------------------ panels
  private clear(): void {
    this.chat?.destroy();
    this.chat = null;
    this.card.innerHTML = '';
  }

  private renderEntry(error = ''): void {
    this.mode = 'entry';
    this.clear();
    const h = this.card;
    const title = this.hud.el('h1', '', h);
    title.textContent = 'Play online';
    const sub = this.hud.el('p', '', h);
    sub.textContent = 'Create a room and share the code, or join a friend’s room.';
    this.errEl = this.hud.el('p', 'net-err', h);
    this.errEl.textContent = error;
    this.errEl.classList.toggle('show', !!error);

    const nameRow = this.hud.el('label', 'net-field', h);
    this.hud.el('span', '', nameRow).textContent = 'Your name';
    const name = this.hud.el('input', '', nameRow) as HTMLInputElement;
    name.maxLength = 12;
    name.value = this.entryName;
    name.oninput = () => (this.entryName = name.value);

    const actions = this.hud.el('div', 'net-actions', h);
    const create = this.hud.el('button', 'btn', actions);
    create.textContent = 'Create room 🌐';
    create.onclick = () => void this.go(() => this.session.host(this.makeProfile()));

    const joinRow = this.hud.el('div', 'join-row', h);
    const code = this.hud.el('input', 'code-input', joinRow) as HTMLInputElement;
    code.placeholder = 'CODE';
    code.maxLength = 5;
    code.value = this.entryCode;
    code.autocapitalize = 'characters';
    code.oninput = () => {
      const n = normalizeCode(code.value);
      code.value = n;
      this.entryCode = n;
    };
    const join = this.hud.el('button', 'btn small', joinRow);
    join.textContent = 'Join ▶';
    join.onclick = () => {
      if (this.entryCode.length < 5) {
        this.showError('Enter the 5-character room code');
        return;
      }
      void this.go(() => this.session.join(this.entryCode, this.makeProfile()));
    };

    const back = this.hud.el('button', 'pill wide', h);
    back.textContent = '← Back';
    back.onclick = () => {
      this.destroy();
      this.cb.onLeave();
    };
  }

  private makeProfile(): { name: string; species: string; color: string } {
    const name = this.entryName.trim().slice(0, 12) || 'Player';
    const seed = name.length + this.entryCode.length;
    return { name, species: SPECIES[seed % SPECIES.length].id, color: JELLY_COLORS[seed % JELLY_COLORS.length] };
  }

  private showError(text: string): void {
    if (!this.errEl) return;
    this.errEl.textContent = text;
    this.errEl.classList.add('show');
  }

  private async go(start: () => Promise<void>): Promise<void> {
    this.mode = 'connecting';
    this.clear();
    const title = this.hud.el('h1', '', this.card);
    title.textContent = 'Connecting…';
    const dots = this.hud.el('p', 'net-dots', this.card);
    dots.textContent = '·  ·  ·';
    await start();
    // success → the 'lobby' event renders the room; failure → 'error' renders entry
    if (this.destroyed) return;
    if (this.session.active && this.session.players.length > 0 && this.mode === 'connecting') {
      // host() resolves straight into a lobby; join() waits for the snapshot
      if (this.session.isHost) this.renderLobby();
    }
  }

  private renderLobby(): void {
    this.mode = 'lobby';
    this.clear();
    const s = this.session;
    const head = this.hud.el('div', 'room-head', this.card);
    this.hud.el('h1', '', head).textContent = s.isHost ? 'Your room' : 'In the room';
    const codeWrap = this.hud.el('div', 'room-code-wrap', this.card);
    const label = this.hud.el('span', 'room-label', codeWrap);
    label.textContent = 'Room code';
    const codeEl = this.hud.el('code', 'room-code', codeWrap);
    codeEl.textContent = s.code;
    const copy = this.hud.el('button', 'pill', codeWrap);
    copy.textContent = '📋 Copy';
    copy.onclick = () => {
      navigator.clipboard?.writeText(s.code).then(
        () => {
          copy.textContent = '✓ Copied';
          window.setTimeout(() => (copy.textContent = '📋 Copy'), 1500);
        },
        () => undefined,
      );
    };

    this.listEl = this.hud.el('div', 'lobby-list', this.card);
    this.errEl = this.hud.el('p', 'net-err', this.card);
    this.statusEl = this.hud.el('div', 'lobby-status', this.card);

    this.chat = new ChatBox(this.hud, this.card, s);

    const leave = this.hud.el('button', 'pill wide', this.card);
    leave.textContent = 'Leave room';
    leave.onclick = () => {
      s.leave(); // 'closed' → destroy
    };

    this.renderOwnRow();
    this.refreshList();
  }

  /** My profile row (editable); other players render in refreshList(). */
  private renderOwnRow(): void {
    const s = this.session;
    const me = s.players.find((p) => p.peerId === s.myPeerId);
    if (!me) return;
    const row = this.hud.el('div', 'lobby-row own', this.listEl);
    row.style.setProperty('--pc', me.color);
    const emoji = this.hud.el('span', 'avatar', row);
    emoji.textContent = SPECIES.find((x) => x.id === me.species)?.emoji ?? '🐱';
    const name = this.hud.el('input', 'name', row) as HTMLInputElement;
    name.value = me.name;
    name.maxLength = 12;
    name.onchange = () => this.pushProfile({ name: name.value.trim().slice(0, 12) || 'Player' });
    const sel = this.hud.el('select', 'animal-select', row) as HTMLSelectElement;
    for (const sp of SPECIES) {
      const o = this.hud.el('option', '', sel);
      o.value = sp.id;
      o.textContent = `${sp.emoji}  ${sp.name}`;
      o.selected = sp.id === me.species;
    }
    sel.onchange = () => {
      this.pushProfile({ species: sel.value });
      emoji.textContent = SPECIES.find((x) => x.id === sel.value)?.emoji ?? '🐱';
    };
    const swatches = this.hud.el('div', 'swatches', row);
    for (const col of JELLY_COLORS) {
      const b = this.hud.el('button', `swatch${me.color === col ? ' on' : ''}`, swatches);
      b.style.background = col;
      b.setAttribute('aria-label', `colour ${col}`);
      b.onclick = () => {
        this.pushProfile({ color: col });
        row.style.setProperty('--pc', col);
        swatches.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      };
    }
  }

  private pushProfile(patch: { name?: string; species?: string; color?: string }): void {
    const cur = profileOf(this.session);
    this.session.updateProfile({ ...cur, ...patch });
    // guests don't get an echo until the host rebroadcasts — show it immediately
    if (!this.session.isHost) {
      const me = this.session.players.find((p) => p.peerId === this.session.myPeerId);
      if (me) Object.assign(me, patch);
    }
  }

  private refreshList(): void {
    if (!this.listEl || !this.statusEl) return;
    const s = this.session;
    // others only — my row stays put so typing isn't interrupted
    const rows = s.players
      .filter((p) => p.peerId !== s.myPeerId)
      .map((p) => {
        const sp = SPECIES.find((x) => x.id === p.species);
        const crown = p.seat === 0 ? '<span class="host-crown" title="Host">👑</span>' : '';
        return `<div class="lobby-row" style="--pc:${p.color}"><span class="avatar">${sp?.emoji ?? '🐱'}</span><span class="rname">${escape(p.name)}</span>${crown}</div>`;
      })
      .join('');
    const placeholder = rows ? '' : '<div class="lobby-empty">Nobody else here yet — share the code!</div>';
    const existingOwn = this.listEl.querySelector('.lobby-row.own');
    this.listEl.innerHTML = rows + placeholder;
    if (existingOwn) this.listEl.prepend(existingOwn);

    // status / start button
    this.statusEl.innerHTML = '';
    if (s.isHost) {
      if (s.players.length >= 2) {
        const go = this.hud.el('button', 'btn', this.statusEl);
        go.textContent = 'Start game ▶';
        go.onclick = () => {
          const configs = s.configs();
          s.gameRunning = true;
          s.broadcastLobby();
          s.send({ t: 'start', configs });
          this.destroy();
          this.cb.onStart(configs);
        };
      } else {
        const wait = this.hud.el('p', 'waiting', this.statusEl);
        wait.textContent = 'Waiting for one more player…';
      }
    } else {
      const wait = this.hud.el('p', 'waiting', this.statusEl);
      wait.textContent = 'Waiting for the host to start…';
    }
  }
}

// ------------------------------------------------------------------ in-game HUD
export interface NetHudCallbacks {
  onEmote: (id: number) => void;
}

/** The always-on room bar during a match: code, chat, emotes, mic. */
export class NetHud {
  readonly chat: ChatBox;
  private root: HTMLElement;
  private emotePop!: HTMLElement;
  private micBtn!: HTMLElement;
  private hud: Hud;
  private session: NetSession;
  private cb: NetHudCallbacks;

  constructor(hud: Hud, session: NetSession, cb: NetHudCallbacks) {
    this.hud = hud;
    this.session = session;
    this.cb = cb;
    this.root = hud.el('div', 'net-hud');

    const bar = this.hud.el('div', 'net-bar', this.root);
    const codeBtn = this.hud.el('button', 'net-chip room', bar);
    codeBtn.textContent = `🌐 ${session.code}`;
    codeBtn.title = 'Room code — click to copy';
    codeBtn.onclick = () => {
      navigator.clipboard?.writeText(session.code).then(
        () => {
          codeBtn.textContent = '✓ copied';
          window.setTimeout(() => (codeBtn.textContent = `🌐 ${session.code}`), 1500);
        },
        () => undefined,
      );
    };

    const chatBtn = this.hud.el('button', 'net-chip', bar);
    chatBtn.textContent = '💬';
    chatBtn.title = 'Chat (T)';
    chatBtn.onclick = () => (this.chat.isOpen ? this.chat.close() : this.chat.open());

    const emoteBtn = this.hud.el('button', 'net-chip', bar);
    emoteBtn.textContent = '😀';
    emoteBtn.title = 'Emotes (1-8)';
    emoteBtn.onclick = () => this.emotePop.classList.toggle('show');

    this.micBtn = this.hud.el('button', 'net-chip', bar);
    this.micBtn.textContent = '🎙';
    this.micBtn.title = 'Toggle voice chat';
    this.micBtn.onclick = () => void this.toggleMic();

    // emote wheel
    this.emotePop = this.hud.el('div', 'emote-pop', this.root);
    EMOTES.forEach((e, i) => {
      const b = this.hud.el('button', 'emote-btn', this.emotePop);
      b.textContent = e;
      b.title = `${i + 1}`;
      b.onclick = () => {
        this.emotePop.classList.remove('show');
        this.cb.onEmote(i);
      };
    });

    this.chat = new ChatBox(this.hud, this.root, session);
  }

  private async toggleMic(): Promise<void> {
    const want = !this.session.micOn;
    const ok = await this.session.setMic(want);
    this.micBtn.classList.toggle('on', ok && this.session.micOn);
    this.micBtn.textContent = ok && this.session.micOn ? '🎙️' : '🎙';
    this.micBtn.title = ok && this.session.micOn ? 'Mic on — click to mute' : 'Mic off — click to talk';
  }

  /** A remote emote: floating emoji element, positioned by the game loop. */
  floatEmote(id: number): HTMLElement {
    const el = this.hud.el('div', 'float-emote', this.hud.root);
    el.textContent = EMOTES[id] ?? '🎉';
    return el;
  }

  setChatOpen(open: boolean): void {
    if (open) this.chat.open();
    else this.chat.close();
  }

  isChatOpen(): boolean {
    return this.chat.isOpen;
  }

  destroy(): void {
    this.chat.destroy();
    this.root.remove();
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
