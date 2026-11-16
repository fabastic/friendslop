/** Game hub: profile, party (online room), friends and the game shelf. */
import { SPECIES, JELLY_COLORS, JellyFolk } from '../characters/jellyfolk.ts';
import type { NetSession } from '../net/session.ts';
import { normalizeCode } from '../net/protocol.ts';
import { Friends } from './friends.ts';
import './hub.css';

export interface Profile {
  name: string;
  species: string;
  color: string;
}

export interface GameCard {
  id: string;
  title: string;
  blurb: string;
  emoji: string;
  tint: string;
  players: string;
  /** Registered + playable; otherwise shown as "coming soon". */
  ready: boolean;
  tag?: string;
}

/** Shelf. Upcoming ideas follow what's trending in co-op "friendslop" & party games. */
export const GAMES: GameCard[] = [
  { id: 'bowling', title: 'Jelly Bowl', blurb: 'Bouncy ten-pin with splits, turkeys and very dramatic pins.', emoji: '🎳', tint: '#ff5fa2', players: '1–4', ready: true, tag: 'Play now' },
  { id: 'peak', title: 'Jelly Peak', blurb: 'Co-op climb: cling to the candy pillar, boost your buddies, plant the flag.', emoji: '🏔️', tint: '#3fd6ff', players: '1–4', ready: true, tag: 'New!' },
  { id: 'wobble', title: 'Wobble Run', blurb: 'Obstacle race through spinning jelly hammers. Last bean out.', emoji: '🏁', tint: '#ffd23f', players: '2–8', ready: false, tag: 'Obstacle race' },
  { id: 'haul', title: 'Spooky Haul', blurb: 'Sneak loot out of a haunted candy factory. Physics will betray you.', emoji: '👻', tint: '#7b4dff', players: '2–6', ready: false, tag: 'Trending: co-op loot' },
  { id: 'tennis', title: 'Squish Tennis', blurb: 'Swing, smash and boing — doubles on a trampoline court.', emoji: '🎾', tint: '#3ccf7a', players: '2–4', ready: false, tag: 'Sports' },
  { id: 'doodle', title: 'Doodle Brawl', blurb: 'Draw it, guess it, vote the funniest. Phones welcome.', emoji: '✏️', tint: '#ff8a3d', players: '3–8', ready: false, tag: 'Party' },
];

const KEY_PROFILE = 'jb.profile';

function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY_PROFILE) ?? '');
    if (p?.name && p?.species && p?.color) return p as Profile;
  } catch {
    /* fallthrough */
  }
  const fresh = { name: 'Jelly ' + Math.floor(100 + Math.random() * 900), species: 'cat', color: JELLY_COLORS[0] };
  try {
    localStorage.setItem(KEY_PROFILE, JSON.stringify(fresh)); // games read it for solo play
  } catch {
    /* ignore */
  }
  return fresh;
}

export interface HubCallbacks {
  /** Launch a game; lineup = party members (or just me). */
  play(id: string, lineup: Profile[], seed?: number): void;
}

export class Hub {
  profile = loadProfile();
  private root: HTMLElement;
  private friends = new Friends();
  private session: NetSession;
  private cb: HubCallbacks;
  private unsub: () => void;
  private toastEl: HTMLElement;
  private busy = false;
  private sawRunning = false;

  constructor(parent: HTMLElement, session: NetSession, cb: HubCallbacks) {
    this.session = session;
    this.cb = cb;
    this.root = document.createElement('div');
    this.root.className = 'hub';
    parent.appendChild(this.root);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'hub-toast';
    document.body.appendChild(this.toastEl);

    this.friends.status = () => ({ name: this.profile.name, party: session.active ? session.code : '' });
    this.friends.onChange = () => this.renderFriends();
    this.friends.onInvite = (i) => this.showInvite(i.name, i.party);
    void this.friends.start();
    this.unsub = session.on((ev) => {
      if (ev.e === 'error') this.toast(ev.text);
      if (ev.e === 'host-lost') this.toast('The party host left 😢');
      if (ev.e === 'msg' && ev.m.t === 'start' && !session.isHost) this.launch(ev.m.game ?? 'bowling', ev.m.seed);
      // leader went back to the hub: follow them so nobody is stranded in a finished game
      if (ev.e === 'lobby' && !session.isHost && this.sawRunning && !session.gameRunning && this.root.classList.contains('hidden')) {
        this.toast('The leader is back in the hub');
        this.show();
      }
      this.sawRunning = session.gameRunning;
      this.renderParty();
    });
    this.render();
  }

  show(): void {
    this.root.classList.remove('hidden');
    if (this.session.active && this.session.isHost && this.session.gameRunning) {
      this.session.gameRunning = false; // leader is back in the hub: the room is free for a new game
      this.session.broadcastLobby();
    }
    this.friends.refresh();
    this.render();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  dispose(): void {
    this.unsub();
    this.friends.dispose();
    this.root.remove();
    this.toastEl.remove();
  }

  // ------------------------------------------------------------ render
  private render(): void {
    this.root.innerHTML = `
      <div class="hub-bg"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <header class="hub-top">
        <div class="hub-logo">Jelly<span>bash</span></div>
        <div class="hub-me"></div>
      </header>
      <main class="hub-main">
        <section class="hub-shelf">
          <h2>Pick a game</h2>
          <div class="hub-games"></div>
        </section>
        <aside class="hub-side">
          <section class="hub-panel hub-party"></section>
          <section class="hub-panel hub-friends"></section>
        </aside>
      </main>`;
    this.renderMe();
    this.renderGames();
    this.renderParty();
    this.renderFriends();
  }

  private q(sel: string): HTMLElement {
    return this.root.querySelector(sel) as HTMLElement;
  }

  private renderMe(): void {
    const el = this.q('.hub-me');
    const sp = SPECIES.find((s) => s.id === this.profile.species) ?? SPECIES[0];
    el.innerHTML = `
      <span class="hub-avatar" style="--pc:${this.profile.color}">${sp.emoji}</span>
      <input class="hub-name" maxlength="14" aria-label="Your name" value="${esc(this.profile.name)}">
      <select class="hub-species" aria-label="Animal">${SPECIES.map((s) => `<option value="${s.id}"${s.id === sp.id ? ' selected' : ''}>${s.emoji} ${s.name}</option>`).join('')}</select>
      <span class="hub-colors">${JELLY_COLORS.map((c) => `<button class="hub-color${c === this.profile.color ? ' on' : ''}" style="--c:${c}" data-c="${c}" aria-label="Colour ${c}"></button>`).join('')}</span>
      <label class="hub-wobble" title="How jiggly the jelly folk are">🍮 Wobble <input type="range" min="0" max="2" step="0.1" value="${JellyFolk.globalWobble}" aria-label="Wobble strength"><output>${wobbleLabel(JellyFolk.globalWobble)}</output></label>`;
    const wob = el.querySelector('.hub-wobble input') as HTMLInputElement;
    const wobOut = el.querySelector('.hub-wobble output') as HTMLOutputElement;
    wob.oninput = () => {
      JellyFolk.setGlobalWobble(parseFloat(wob.value));
      wobOut.textContent = wobbleLabel(JellyFolk.globalWobble);
    };
    const name = el.querySelector('.hub-name') as HTMLInputElement;
    name.onchange = () => this.setProfile({ name: name.value.trim() || this.profile.name });
    const species = el.querySelector('.hub-species') as HTMLSelectElement;
    species.onchange = () => this.setProfile({ species: species.value });
    el.querySelectorAll<HTMLButtonElement>('.hub-color').forEach((b) => (b.onclick = () => this.setProfile({ color: b.dataset.c! })));
  }

  private setProfile(p: Partial<Profile>): void {
    this.profile = { ...this.profile, ...p };
    try {
      localStorage.setItem(KEY_PROFILE, JSON.stringify(this.profile));
    } catch {
      /* ignore */
    }
    if (this.session.active) this.session.updateProfile(this.profile);
    this.renderMe();
  }

  private renderGames(): void {
    const el = this.q('.hub-games');
    el.innerHTML = GAMES.map((g, i) => `
      <button class="hub-game${g.ready ? '' : ' soon'}" style="--gt:${g.tint};--d:${i * 60}ms" data-id="${g.id}" ${g.ready ? '' : 'aria-disabled="true"'}>
        <span class="hg-art">${g.emoji}</span>
        <span class="hg-tag">${g.ready ? g.tag : 'Coming soon'}</span>
        <b>${g.title}</b>
        <span class="hg-blurb">${g.blurb}</span>
        <span class="hg-players">👥 ${g.players}${g.ready ? '' : ' · ' + g.tag}</span>
      </button>`).join('');
    el.querySelectorAll<HTMLButtonElement>('.hub-game').forEach((b) => {
      b.onclick = () => {
        const g = GAMES.find((x) => x.id === b.dataset.id)!;
        const runSeed = (Math.random() * 2 ** 31) | 0;
        if (!g.ready) return this.toast(`${g.title} is still in the jelly mould 🍮`);
        if (this.session.active && !this.session.isHost) return this.toast('Only the party leader picks the game');
        if (this.session.active) {
          this.session.send({ t: 'start', configs: this.session.configs(), game: g.id, seed: runSeed });
          this.session.gameRunning = true;
          this.session.broadcastLobby();
        }
        b.classList.add('launching');
        window.setTimeout(() => {
          b.classList.remove('launching');
          this.launch(g.id, runSeed);
        }, 420);
      };
    });
  }

  private launch(id: string, seed?: number): void {
    const lineup: Profile[] = this.session.active
      ? this.session.players.map((p) => ({ name: p.name, species: p.species, color: p.color }))
      : [this.profile];
    this.hide();
    this.cb.play(id, lineup, seed);
  }

  private renderParty(): void {
    const el = this.q('.hub-party');
    if (!el) return;
    const s = this.session;
    if (!s.active) {
      const html = `
        <h3>Party</h3>
        <p class="hub-muted">Play online with up to 4 friends. Share the code or invite from your friends list.</p>
        <button class="hub-btn primary hp-create"${this.busy ? ' disabled' : ''}>${this.busy ? '<span class="hub-spin"></span> Connecting…' : '🎉 Start a party'}</button>
        <div class="hub-row"><input class="hp-code" maxlength="5" placeholder="CODE" aria-label="Party code"${this.busy ? ' disabled' : ''}><button class="hub-btn hp-join"${this.busy ? ' disabled' : ''}>Join</button></div>
        ${this.busy ? '<p class="hub-muted hp-wait">Finding the room… this can take up to 20 s on mobile data.</p>' : ''}`;
      rerender(el, html, () => {
        (el.querySelector('.hp-create') as HTMLButtonElement).onclick = () => this.wrap(s.host(this.profile));
        const code = el.querySelector('.hp-code') as HTMLInputElement;
        code.oninput = () => (code.value = normalizeCode(code.value));
        const join = () => {
          if (code.value.length < 5) return this.toast('Codes are 5 letters');
          this.wrap(s.join(code.value, this.profile));
        };
        code.onkeydown = (e) => e.key === 'Enter' && join();
        (el.querySelector('.hp-join') as HTMLButtonElement).onclick = join;
      });
      return;
    }
    const html = `
      <h3>Party <span class="hp-badge">${s.isHost ? 'Leader' : 'Member'}</span></h3>
      <button class="hp-codebig" title="Copy code">${s.code}<small>tap to copy</small></button>
      <ul class="hp-list">${s.players.map((p) => {
        const sp = SPECIES.find((x) => x.id === p.species) ?? SPECIES[0];
        return `<li style="--pc:${p.color}"><span class="hub-avatar sm">${sp.emoji}</span>${esc(p.name)}${p.seat === 0 ? ' 👑' : ''}${p.seat === s.mySeat ? ' <i>(you)</i>' : ''}</li>`;
      }).join('')}${'<li class="empty">waiting for a friend…</li>'.repeat(Math.max(0, 4 - s.players.length))}</ul>
      <div class="hp-chat">${s.chat.slice(-8).map((c) => `<p><b>${esc(c.name)}:</b> ${esc(c.text)}</p>`).join('') || '<p class="hub-muted">No messages yet</p>'}</div>
      <div class="hub-row"><input class="hp-say" maxlength="140" placeholder="Say hi…" aria-label="Chat message"><button class="hub-btn hp-send">Send</button></div>
      <p class="hub-muted">${s.gameRunning && !s.isHost ? '🎳 A game is running — you\'ll join the next one.' : s.isHost ? 'Pick a game to start for everyone.' : 'The leader picks the game.'}</p>
      <button class="hub-btn ghost hp-leave">Leave party</button>`;
    rerender(el, html, () => this.bindParty(el));
    const chat = el.querySelector('.hp-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  private bindParty(el: HTMLElement): void {
    const s = this.session;
    (el.querySelector('.hp-codebig') as HTMLButtonElement).onclick = () => {
      void navigator.clipboard?.writeText(s.code).catch(() => {});
      this.toast('Code copied!');
    };
    const say = el.querySelector('.hp-say') as HTMLInputElement;
    const send = () => {
      if (!say.value.trim()) return;
      s.sendChat(s.mySeat, say.value.trim());
      say.value = '';
    };
    say.onkeydown = (e) => e.key === 'Enter' && send();
    (el.querySelector('.hp-send') as HTMLButtonElement).onclick = send;
    (el.querySelector('.hp-leave') as HTMLButtonElement).onclick = () => {
      s.leave();
      this.renderParty();
      this.renderFriends();
    };
  }

  private wrap(p: Promise<void>): void {
    this.busy = true;
    this.renderParty();
    p.catch((e) => this.toast(String(e))).finally(() => {
      this.busy = false;
      this.renderParty();
      this.renderFriends();
    });
  }

  private renderFriends(): void {
    const el = this.q('.hub-friends');
    if (!el) return;
    const f = this.friends;
    const inParty = this.session.active;
    const html = `
      <h3>Friends <span class="hub-muted">${f.list.filter((x) => x.online).length} online</span></h3>
      <p class="hub-muted">Your friend code: <button class="hf-mycode" title="Copy">${f.myCode}</button></p>
      <ul class="hf-list">${f.list.length ? f.list.map((x) => `
        <li class="${x.online ? 'on' : ''}">
          <span class="hf-dot"></span><span class="hf-name">${esc(x.name)}</span>
          ${x.online && x.party ? `<button class="hub-btn sm hf-join" data-p="${x.party}">Join</button>` : ''}
          ${x.online && inParty ? `<button class="hub-btn sm hf-inv" data-c="${x.code}">Invite</button>` : ''}
          <button class="hf-x" data-c="${x.code}" aria-label="Remove ${esc(x.name)}">×</button>
        </li>`).join('') : '<li class="empty">No friends yet — swap codes!</li>'}</ul>
      <div class="hub-row"><input class="hf-code" maxlength="7" placeholder="Friend code" aria-label="Friend code"><button class="hub-btn hf-add">Add</button></div>`;
    rerender(el, html, () => this.bindFriends(el));
  }

  private bindFriends(el: HTMLElement): void {
    const f = this.friends;
    (el.querySelector('.hf-mycode') as HTMLButtonElement).onclick = () => {
      void navigator.clipboard?.writeText(f.myCode).catch(() => {});
      this.toast('Friend code copied!');
    };
    const code = el.querySelector('.hf-code') as HTMLInputElement;
    (el.querySelector('.hf-add') as HTMLButtonElement).onclick = () => {
      const err = f.add(code.value, 'Friend');
      if (!err) code.value = '';
      this.toast(err ?? 'Friend added! Checking if they\'re online…');
    };
    el.querySelectorAll<HTMLButtonElement>('.hf-inv').forEach((b) => (b.onclick = () => {
      f.invite(b.dataset.c!);
      this.toast('Invite sent 💌');
    }));
    el.querySelectorAll<HTMLButtonElement>('.hf-join').forEach((b) => (b.onclick = () => this.wrap(this.session.join(b.dataset.p!, this.profile))));
    el.querySelectorAll<HTMLButtonElement>('.hf-x').forEach((b) => (b.onclick = () => f.remove(b.dataset.c!)));
  }

  private showInvite(name: string, party: string): void {
    const d = document.createElement('div');
    d.className = 'hub-invite';
    d.innerHTML = `<b>${esc(name)}</b> invited you to a party! <button class="hub-btn primary sm">Join</button><button class="hub-btn ghost sm">Nah</button>`;
    document.body.appendChild(d);
    const [yes, no] = d.querySelectorAll('button');
    yes.onclick = () => {
      d.remove();
      this.show();
      this.wrap(this.session.join(party, this.profile));
    };
    no.onclick = () => d.remove();
    setTimeout(() => d.remove(), 20_000);
  }

  private toast(t: string): void {
    this.toastEl.textContent = t;
    this.toastEl.classList.remove('in');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('in');
  }
}

/**
 * Re-render a panel without the jank: typed text, focus and caret survive, and only a
 * genuinely new layout gets the entrance animation.
 */
function rerender(el: HTMLElement, html: string, bind: () => void): void {
  if (el.dataset.html === html) return; // nothing changed
  const values = new Map<string, string>();
  el.querySelectorAll<HTMLInputElement>('input').forEach((i) => values.set(i.className, i.value));
  const active = document.activeElement as HTMLInputElement | null;
  const focusCls = active && el.contains(active) ? active.className : '';
  const caret = focusCls ? active!.selectionStart : null;
  const first = !el.dataset.html;
  el.dataset.html = html;
  el.innerHTML = html;
  el.classList.toggle('settled', !first);
  el.querySelectorAll<HTMLInputElement>('input').forEach((i) => {
    const v = values.get(i.className);
    if (v !== undefined) i.value = v;
  });
  if (focusCls) {
    const f = el.querySelector<HTMLInputElement>(`input[class="${focusCls}"]`);
    f?.focus();
    if (f && caret !== null) f.setSelectionRange(caret, caret);
  }
  bind();
}

function wobbleLabel(v: number): string {
  return v === 0 ? 'Firm' : v < 0.7 ? 'Soft' : v <= 1.3 ? 'Jelly' : v < 1.8 ? 'Wobbly' : 'Max jiggle';
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
