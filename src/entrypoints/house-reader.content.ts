// ISOLATED-world half of the House floor reader, injected on live.house.gov by
// the service worker under the icon click's activeTab grant, just before
// `house-player` (MAIN world). It takes the player's cues from there,
// de-duplicates the roll-up and sends segments to the offscreen document.

import { defineContentScript } from 'wxt/utils/define-content-script';
import { isHouseBridgeMessage, postToBridge } from '../captions/house-bridge';
import { createHouseCaptions } from '../captions/house-captions';
import { onMessage, sendMessage } from '../messages';

export default defineContentScript({
  registration: 'runtime',
  main(ctx) {
    const captions = createHouseCaptions();
    let playerId: string | undefined;

    const onBridge = (event: MessageEvent) => {
      if (!isHouseBridgeMessage(event, window)) return;
      const message = event.data;
      if (message.type === 'ready') playerId = message.playerId;
      if (message.type !== 'cue' || message.playerId !== playerId) return;
      for (const segment of captions.cue(message.cue)) {
        sendMessage({ to: 'offscreen', type: 'caption', segment }).catch(() => {});
      }
    };
    window.addEventListener('message', onBridge);

    const stopListening = onMessage('reader', {
      'stop-reading': () => ctx.abort('stopped'),
    });
    ctx.onInvalidated(() => {
      window.removeEventListener('message', onBridge);
      stopListening();
      if (playerId) postToBridge(window, { claimcatcher: 'house', type: 'stop', playerId });
    });
  },
});
