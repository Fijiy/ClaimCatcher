// Injected into the listened tab by the service worker, beside the caption
// reader, under the icon click's activeTab grant (`registration: 'runtime'`);
// never declared to run on every page. Audio is captured the whole time
// listening is on, even on captioned pages, so the on-device transcript can
// take over the moment captions stop.
//
// It sends the audio over a port to the offscreen document only. When that
// port closes (listening stopped, the document closed) capture stops.

import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { capturePageAudio } from '../audio/page-audio';
import { encodePcm } from '../audio/pcm';
import { AUDIO_PORT, type PageAudioMessage } from '../audio/port';
import { onMessage } from '../messages';

export default defineContentScript({
  registration: 'runtime',
  main(ctx) {
    const port = browser.runtime.connect({ name: AUDIO_PORT });
    const post = (message: PageAudioMessage) => port.postMessage(message);
    const stopCapture = capturePageAudio(document, {
      frame: (sampleRate, samples, time) => post({ type: 'pcm', sampleRate, time, data: encodePcm(samples) }),
      failed: (failure, message) => post({ type: 'capture-failed', failure, message }),
      playerAt: (time) => post({ type: 'player-time', time }),
    });
    port.onDisconnect.addListener(() => ctx.abort('the session ended'));
    const stopListening = onMessage('reader', {
      'stop-reading': () => ctx.abort('stopped'),
    });
    ctx.onInvalidated(() => {
      stopCapture();
      stopListening();
      port.disconnect();
    });
  },
});
