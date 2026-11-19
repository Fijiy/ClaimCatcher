// MAIN-world half of the House floor reader, injected on live.house.gov by the
// service worker under the icon click's activeTab grant, right after
// `house-reader` (ISOLATED world), which it reports to. The player object is
// only reachable from the page's own world. See src/captions/house-bridge.ts.

import { defineContentScript } from 'wxt/utils/define-content-script';
import { isHouseBridgeMessage, postToBridge } from '../captions/house-bridge';
import { followHousePlayer } from '../captions/house-player';

/** Where a running copy keeps its stop function, so injecting again replaces it. */
const RUNNING = Symbol.for('claimcatcher.house-player');

export default defineContentScript({
  registration: 'runtime',
  world: 'MAIN',
  main() {
    const slot = window as unknown as Record<symbol, (() => void) | undefined>;
    slot[RUNNING]?.();

    const playerId = crypto.randomUUID();
    const stopFollowing = followHousePlayer(window, (cue) => postToBridge(window, { claimcatcher: 'house', type: 'cue', playerId, cue }));
    const onMessage = (event: MessageEvent) => {
      if (isHouseBridgeMessage(event, window) && event.data.type === 'stop' && event.data.playerId === playerId) stop();
    };
    function stop() {
      window.removeEventListener('message', onMessage);
      stopFollowing();
      if (slot[RUNNING] === stop) slot[RUNNING] = undefined;
    }
    window.addEventListener('message', onMessage);
    slot[RUNNING] = stop;
    postToBridge(window, { claimcatcher: 'house', type: 'ready', playerId });
  },
});
