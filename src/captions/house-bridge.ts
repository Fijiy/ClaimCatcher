// Messages between the House reader's two halves in the page:
//
//   house-player  MAIN world: the only place the Bitmovin player object is
//                 reachable. Switches CC1 on and forwards `cueenter` events.
//   house-reader  ISOLATED world: de-duplicates the cues and sends segments to
//                 the offscreen document (MAIN world has no extension APIs).
//
// They talk with `window.postMessage`, which the page can see and could fake.
// A page can already put any words in its own captions, so nothing here is
// trusted more than that.

import type { HouseCue } from './house-captions';

export type HouseBridgeMessage =
  | { claimcatcher: 'house'; type: 'ready'; playerId: string }
  | { claimcatcher: 'house'; type: 'cue'; playerId: string; cue: HouseCue }
  | { claimcatcher: 'house'; type: 'stop'; playerId: string };

export function isHouseBridgeMessage(event: MessageEvent, win: Window): event is MessageEvent<HouseBridgeMessage> {
  const data: unknown = event.data;
  return event.source === win && typeof data === 'object' && data !== null && (data as { claimcatcher?: unknown }).claimcatcher === 'house';
}

export function postToBridge(win: Window, message: HouseBridgeMessage) {
  win.postMessage(message, win.location.origin);
}
