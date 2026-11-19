// The on-video pill: red dot, "Listening", Show panel, Stop. It sits on the
// video while listening goes on with the side panel hidden: closed, or
// covered because the page went fullscreen. In fullscreen it is drawn inside
// the fullscreen element, or in the top layer when that element can't hold
// children (a <video> itself), so it stays on screen.
//
// Runs in the page (ISOLATED world) under a shadow root, so the page's CSS
// can't reach it. It knows nothing about messaging: the entry script tells it
// whether the panel is shown and handles its two buttons.

import { addPillFont, PILL_FONT } from './font';

export interface Pill {
  /** Whether the side panel is showing in this tab's window. */
  setPanelShown(shown: boolean): void;
  /** Takes the pill off the page and stops watching it. */
  remove(): void;
}

export interface PillActions {
  showPanel(): void;
  stop(): void;
}

const GAP = 12;

export function mountPill(doc: Document, actions: PillActions): Pill {
  const win = doc.defaultView!;
  addPillFont(doc);
  const host = doc.createElement('claimcatcher-pill');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
    <div class="pill" role="region" aria-label="ClaimCatcher">
      <span class="listen"><i aria-hidden="true"></i>Listening</span>
      <button type="button" class="show">Show panel</button>
      <button type="button" class="stop">Stop</button>
    </div>`;
  const pill = root.querySelector<HTMLElement>('.pill')!;
  // Only the viewer's own clicks count, not a page script calling .click().
  const onTrusted = (action: () => void) => (event: Event) => {
    if (event.isTrusted) action();
  };
  root.querySelector('.show')!.addEventListener(
    'click',
    onTrusted(() => {
      actions.showPanel(); // first, while the click's user gesture is live
      // The side panel can't be seen over a fullscreen page.
      if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {});
    }),
  );
  root.querySelector('.stop')!.addEventListener('click', onTrusted(actions.stop));

  const style = (name: string, value: string) => host.style.setProperty(name, value, 'important');
  for (const [name, value] of Object.entries(HOST_STYLE)) style(name, value);

  let panelShown = true; // until told otherwise: never flash over a visible panel
  let removed = false;

  function place() {
    if (removed) return;
    const fullscreen = doc.fullscreenElement;
    const visible = !panelShown || fullscreen !== null;
    if (!visible) {
      if (host.isConnected) detach();
      return;
    }
    const container = fullscreen && canHoldChildren(fullscreen) ? fullscreen : doc.documentElement;
    if (host.parentNode !== container) {
      detach();
      container.append(host);
    }
    // A fullscreen <video> or <img> can't hold the pill: lift it into the top layer instead.
    const topLayer = fullscreen !== null && container !== fullscreen;
    if (topLayer && !host.matches(':popover-open')) {
      host.popover = 'manual';
      host.showPopover();
    }
    const box = targetBox(doc, fullscreen);
    style('top', `${Math.max(GAP, box.top + GAP)}px`);
    style('right', `${Math.max(GAP, win.innerWidth - box.right + GAP)}px`);
  }

  function detach() {
    if (host.matches(':popover-open')) host.hidePopover();
    host.removeAttribute('popover');
    host.remove();
  }

  // Keep it on the video as the page scrolls, resizes or swaps its player.
  const onChange = () => place();
  doc.addEventListener('fullscreenchange', onChange);
  win.addEventListener('scroll', onChange, { capture: true, passive: true });
  win.addEventListener('resize', onChange);
  const timer = win.setInterval(onChange, 1000);
  place();

  return {
    setPanelShown(shown) {
      panelShown = shown;
      place();
    },
    remove() {
      removed = true;
      doc.removeEventListener('fullscreenchange', onChange);
      win.removeEventListener('scroll', onChange, { capture: true });
      win.removeEventListener('resize', onChange);
      win.clearInterval(timer);
      detach();
    },
  };
}

/** The video to sit on: the largest one showing, inside the fullscreen element if any. */
function targetBox(doc: Document, fullscreen: Element | null): { top: number; right: number } {
  const win = doc.defaultView!;
  const scope = fullscreen ?? doc;
  const videos = fullscreen instanceof HTMLVideoElement ? [fullscreen] : [...scope.querySelectorAll('video')];
  let best: DOMRect | undefined;
  for (const video of videos) {
    const box = video.getBoundingClientRect();
    if (box.width * box.height === 0) continue;
    if (!best || box.width * box.height > best.width * best.height) best = box;
  }
  // No video in view: the top right of the window.
  if (!best || best.bottom < 0 || best.top > win.innerHeight) return { top: 0, right: win.innerWidth };
  return { top: best.top, right: Math.min(best.right, win.innerWidth) };
}

function canHoldChildren(element: Element): boolean {
  return !(element instanceof HTMLMediaElement || element instanceof HTMLImageElement || element instanceof HTMLCanvasElement || element instanceof HTMLIFrameElement);
}

const HOST_STYLE: Record<string, string> = {
  all: 'initial',
  position: 'fixed',
  'z-index': '2147483647',
  inset: 'auto',
  margin: '0',
  padding: '0',
  border: '0',
  background: 'transparent',
  overflow: 'visible',
  display: 'block',
};

// From the live-panel prototype's `.apill`: white, rounded, shadowed.
const CSS = `
  .pill {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 6px 5px 12px;
    background: rgba(255, 255, 255, 0.96); color: #0a0a0a;
    border-radius: 999px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    font: 12px/1.2 '${PILL_FONT}'; white-space: nowrap;
  }
  .listen { display: inline-flex; align-items: center; gap: 7px; font-weight: 700; }
  .listen i {
    width: 8px; height: 8px; border-radius: 50%; background: #e5383b;
    box-shadow: 0 0 0 0 rgba(229, 56, 59, 0.45); animation: breathe 1.6s infinite;
  }
  @keyframes breathe { 70% { box-shadow: 0 0 0 6px rgba(229, 56, 59, 0); } 100% { box-shadow: 0 0 0 0 rgba(229, 56, 59, 0); } }
  @media (prefers-reduced-motion: reduce) { .listen i { animation: none; } }
  button {
    height: 26px; padding: 0 11px; border: 0; border-radius: 999px;
    background: #ececec; color: #0a0a0a; font: inherit; cursor: pointer;
  }
  button:hover { background: #e3e3e3; }
  button:focus-visible { outline: 2px solid #0a0a0a; outline-offset: 2px; }
`;
