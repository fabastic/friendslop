/** Thin DOM overlay helper. Each game builds into its own root, removed on clear(). */
export class Hud {
  readonly root: HTMLElement;
  private bannerEl: HTMLElement | null = null;
  private bannerTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent: HTMLElement = this.root): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    parent.appendChild(e);
    return e;
  }

  banner(text: string, ms = 1400, color?: string): void {
    if (!this.bannerEl) this.bannerEl = this.el('div', 'banner');
    const b = this.bannerEl;
    b.textContent = text;
    b.style.color = color ?? '';
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.remove('show'), ms);
  }

  clear(): void {
    clearTimeout(this.bannerTimer);
    this.root.innerHTML = '';
    this.bannerEl = null;
  }
}
