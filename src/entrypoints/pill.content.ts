// Injected into the listened tab with the caption readers, under the same
// activeTab grant (`registration: 'runtime'`). Shows the on-video pill while
// the side panel is hidden; see src/pill/pill.ts. Injecting again replaces the
// previous copy (WXT invalidates the old context).

import { defineContentScript } from 'wxt/utils/define-content-script';
import { onMessage, sendMessage } from '../messages';
import { mountPill } from '../pill/pill';

export default defineContentScript({
  registration: 'runtime',
  main(ctx) {
    const pill = mountPill(document, {
      // Sent from the click itself: the service worker opens the panel with its gesture.
      showPanel: () => void sendMessage({ to: 'background', type: 'show-panel' }).catch(() => {}),
      stop: () => void sendMessage({ to: 'background', type: 'stop-listening' }).catch(() => {}),
    });
    let told = false; // a pushed change is newer than the answer to our question
    const stopListening = onMessage('pill', {
      'panel-shown': ({ shown }) => {
        told = true;
        pill.setPanelShown(shown);
      },
      'remove-pill': () => ctx.abort('stopped'),
    });
    void sendMessage({ to: 'background', type: 'get-panel-shown' })
      .then((shown) => {
        if (!told) pill.setPanelShown(shown ?? true);
      })
      .catch(() => {});
    ctx.onInvalidated(() => {
      pill.remove();
      stopListening();
    });
  },
});
