// Injected by the service worker through `scripting` under the icon click's
// activeTab grant (`registration: 'runtime'`): it is never declared to run on
// every page. Injecting again replaces the previous copy (WXT invalidates the
// old context).

import { defineContentScript } from 'wxt/utils/define-content-script';
import { readTextTracks } from '../captions/track-reader';
import { onMessage, sendMessage } from '../messages';

export default defineContentScript({
  registration: 'runtime',
  main(ctx) {
    const stopReading = readTextTracks(document, (segment) => {
      sendMessage({ to: 'offscreen', type: 'caption', segment }).catch(() => {});
    });
    const stopListening = onMessage('reader', {
      'stop-reading': () => ctx.abort('stopped'),
    });
    ctx.onInvalidated(() => {
      stopReading();
      stopListening();
    });
  },
});
