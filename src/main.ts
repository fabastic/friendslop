import RAPIER from '@dimforge/rapier3d-compat';
import { Engine } from './core/engine.ts';
import { Hud } from './core/hud.ts';
import { Input } from './core/input.ts';
import { Sfx } from './core/audio.ts';
import { registerGame, registry, type GameContext, type Minigame } from './core/minigame.ts';
import { Bowling, BOWLING_ASSETS, presetLineup } from './games/bowling/bowling.ts';
import { Hub } from './hub/hub.ts';
import { Peak } from './games/peak/peak.ts';
import { preloadAssets } from './core/assets.ts';
import { NetSession } from './net/session.ts';

registerGame('bowling', 'Jelly Bowl', () => new Bowling());
registerGame('peak', 'Jelly Peak', () => new Peak());

async function boot(): Promise<void> {
  await Promise.all([RAPIER.init(), preloadAssets(BOWLING_ASSETS)]);
  const app = document.getElementById('app')!;
  const engine = new Engine(app);
  const hud = new Hud(document.getElementById('hud')!);
  const input = new Input(engine.renderer.domElement);
  const sfx = new Sfx();

  const net = new NetSession();
  // closing the tab says goodbye right away instead of waiting for WebRTC to time out
  window.addEventListener('pagehide', () => {
    if (net.active) net.leave();
  });
  let current: Minigame | null = null;
  let currentId = 'bowling';

  const load = (id: string) => {
    if (current) {
      current.dispose();
      input.clearHandlers();
    }
    const entry = registry.get(id);
    if (!entry) throw new Error(`unknown game ${id}`);
    currentId = id;
    current = entry.create();
    current.init(ctx);
    engine.setGame(current);
  };

  const ctx: GameContext = {
    R: RAPIER,
    renderer: engine.renderer,
    hud,
    input,
    sfx,
    net,
    requestRestart: () => queueMicrotask(() => load(currentId)),
    exitToHub: () => queueMicrotask(() => hub.show()),
  };

  const hub = new Hub(document.body, net, {
    play: (id, lineup) => {
      presetLineup(lineup);
      load(id);
    },
  });

  load(currentId); // bowling lane stays alive as the hub's backdrop
  engine.start();

  // Debug / automation hook
  (window as unknown as { __game: unknown }).__game = {
    get game() {
      return current?.debug;
    },
    get scene() {
      return current?.scene;
    },
    get camera() {
      return current?.camera;
    },
    step: (n: number) => engine.step(n),
    load,
    restart: () => load(currentId),
    renderer: engine.renderer,
  };
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;color:red">${String(e)}</pre>`);
});
