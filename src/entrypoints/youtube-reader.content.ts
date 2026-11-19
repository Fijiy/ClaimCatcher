// Injected on YouTube by the service worker under the icon click's activeTab
// grant (`registration: 'runtime'`); never declared to run on every page.

import { defineContentScript } from 'wxt/utils/define-content-script';
import { readYouTubeCaptions } from '../captions/youtube-reader';
import { onMessage, sendMessage } from '../messages';

export default defineContentScript({
  registration: 'runtime',
  main(ctx) {
    const stopReading = readYouTubeCaptions(document, (segment) => {
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
