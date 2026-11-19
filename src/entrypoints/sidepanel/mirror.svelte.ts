// The panel's copy of the session. Display only: it folds the offscreen
// document's events with the same `applyEvent` the session uses, and asks for
// a snapshot when it opens or misses an event. The offscreen document keeps
// a stopped session until Clear now or a new session, so a panel opened after
// Stop gets it from the snapshot; this copy outlives the document only if it
// closes anyway. It also mirrors the router's one question for the viewer:
// whether to switch listening to the tab they just clicked on.

import { onMessage, sendMessage, type SwitchRequest } from '../../messages';
import type { SessionEvent, SessionView } from '../../session/types';
import { applyEvent, clearView, emptyView } from '../../session/view';

export class SessionMirror {
  view = $state<SessionView>(emptyView);
  /** "Stop listening on <first tab> and listen here?", while it waits for an answer. */
  switchRequest = $state<SwitchRequest | null>(null);
  #syncing = false;
  #held: SessionEvent[] = [];
  /** Sources opened here that the session hasn't confirmed yet (or can't: its document closed after Stop). */
  #openedHere = $state<{ sessionId: string | null; urls: string[] }>({ sessionId: null, urls: [] });

  /** Whether the viewer opened this source in the current session. */
  isOpened(url: string): boolean {
    const here = this.#openedHere;
    return this.view.opened.includes(url) || (here.sessionId === this.view.sessionId && here.urls.includes(url));
  }

  /** The viewer opened a source: mark it now, and tell the session, which keeps the mark. */
  markOpened(url: string) {
    const sessionId = this.view.sessionId;
    const here = this.#openedHere;
    this.#openedHere = { sessionId, urls: [...(here.sessionId === sessionId ? here.urls : []), url] };
    sendMessage({ to: 'offscreen', type: 'source-opened', url }).catch(() => {});
  }

  /** Starts mirroring. Returns a function that stops it. */
  connect(): () => void {
    const off = onMessage('panel', {
      'session-event': ({ event }) => this.#receive(event),
      'switch-request': ({ request }) => void (this.switchRequest = request),
    });
    void this.#resync();
    void sendMessage({ to: 'background', type: 'get-switch-request' })
      .then((request) => (this.switchRequest = request ?? null))
      .catch(() => {});
    return off;
  }

  /**
   * Clear now. A session that is still running (or finishing its last checks)
   * clears itself and says so; one whose document has closed lives only here.
   */
  async clear() {
    const sessionId = this.view.sessionId;
    const cleared = await sendMessage({ to: 'offscreen', type: 'clear-session' }).catch(() => undefined);
    if (cleared?.sessionId && cleared.sessionId === sessionId) {
      // The "cleared" event may have got here first, and more after it.
      if (cleared.seq > this.view.seq) this.view = cleared;
    } else if (this.view.sessionId === sessionId) this.view = clearView(this.view);
  }

  #receive(event: SessionEvent) {
    if (this.#syncing) {
      this.#held.push(event);
      return;
    }
    const view = this.view;
    if (event.sessionId !== view.sessionId) {
      if (event.type === 'started' && event.seq === 1) this.view = applyEvent(emptyView, event);
      else void this.#resync();
    } else if (event.seq === view.seq + 1) {
      this.view = applyEvent(view, event);
    } else if (event.seq > view.seq + 1) {
      void this.#resync(); // missed one
    } // else: already folded in
  }

  async #resync() {
    this.#syncing = true;
    try {
      const snapshot = await sendMessage({ to: 'offscreen', type: 'get-snapshot' });
      if (snapshot?.sessionId) this.view = snapshot;
    } catch {
      // No offscreen document: nothing is listening. Keep what we have.
    } finally {
      this.#syncing = false;
      for (const event of this.#held.splice(0)) this.#receive(event);
    }
  }
}
