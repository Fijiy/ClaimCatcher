// The MAIN-world half of the House floor reader (live.house.gov, Bitmovin).
// Finds the player, switches the English track (CC1) on by itself, so CC3
// Spanish doesn't interleave on screen, and reports every `cueenter` event.
// When it stops it puts the viewer's caption tracks back as they were.
//
// Player API as used on the real site in task/site-capture-test (#23):
// `floorcast.views.videoView.getPlayerInstance?.() || .getPlayer?.()`,
// `subtitles.list()/enable(id, exclusive)/disable(id)`, `on/off('cueenter')`.

import { ENGLISH_TRACK, type HouseCue } from './house-captions';

interface SubtitleTrack {
  id: string;
  enabled?: boolean;
}

interface CueEvent {
  start: number;
  end?: number;
  text?: string;
  html?: string;
  subtitleId: string;
}

interface SubtitleAddedEvent {
  subtitle?: SubtitleTrack;
}

interface BitmovinPlayer {
  on(event: string, handler: (event: never) => void): void;
  off(event: string, handler: (event: never) => void): void;
  subtitles: {
    list(): SubtitleTrack[];
    enable(id: string, exclusive?: boolean): void;
    disable(id: string): void;
  };
}

interface FloorcastWindow {
  floorcast?: { views?: { videoView?: { getPlayerInstance?(): unknown; getPlayer?(): unknown } } };
}

/** How often to look for the player while the page is still building it. */
const POLL_MS = 500;
const GIVE_UP_MS = 120_000;

/** Starts following the player. Returns a function that stops and restores the tracks. */
export function followHousePlayer(win: Window, onCue: (cue: HouseCue) => void): () => void {
  let stopFollowing: (() => void) | undefined;
  let stopped = false;
  const startedAt = Date.now();

  const poll = () => {
    if (stopped) return;
    const player = findPlayer(win);
    if (player) stopFollowing = follow(player, onCue);
    else if (Date.now() - startedAt < GIVE_UP_MS) timer = win.setTimeout(poll, POLL_MS);
  };
  let timer = win.setTimeout(poll, 0);

  return () => {
    stopped = true;
    win.clearTimeout(timer);
    stopFollowing?.();
  };
}

function findPlayer(win: Window): BitmovinPlayer | undefined {
  const view = (win as Window & FloorcastWindow).floorcast?.views?.videoView;
  const player = (view?.getPlayerInstance?.() ?? view?.getPlayer?.()) as BitmovinPlayer | undefined;
  return player && typeof player.on === 'function' && player.subtitles ? player : undefined;
}

function follow(player: BitmovinPlayer, onCue: (cue: HouseCue) => void): () => void {
  const enabledBefore = player.subtitles.list().filter((t) => t.enabled).map((t) => t.id);

  const englishOn = () => {
    if (player.subtitles.list().some((t) => t.id === ENGLISH_TRACK)) player.subtitles.enable(ENGLISH_TRACK, true);
  };
  const onCueEnter = (event: CueEvent) => {
    const text = event.text ?? htmlText(event.html ?? '');
    onCue({ subtitleId: event.subtitleId, start: event.start, end: event.end, text });
  };
  // CC1 may only be listed once the stream starts.
  const onSubtitleAdded = (event: SubtitleAddedEvent) => {
    if (event.subtitle?.id === ENGLISH_TRACK) englishOn();
  };

  player.on('cueenter', onCueEnter);
  player.on('subtitleadded', onSubtitleAdded);
  englishOn();

  return () => {
    player.off('cueenter', onCueEnter);
    player.off('subtitleadded', onSubtitleAdded);
    try {
      if (!enabledBefore.includes(ENGLISH_TRACK)) player.subtitles.disable(ENGLISH_TRACK);
      for (const id of enabledBefore) player.subtitles.enable(id);
    } catch {
      // The player may be gone with the page.
    }
  };
}

/** A cue's text when only its HTML is given, parsed inertly. */
function htmlText(html: string): string {
  return new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, ' '), 'text/html').body.textContent ?? '';
}
