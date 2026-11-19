// Local mode's state for a page that shows it (the first-run page / Privacy &
// data, the side panel): Chrome's availability report, and the one-click
// Gemini Nano download with its progress. While the model is downloadable or
// downloading it keeps asking Chrome, so a download started on another page
// shows here too.

import { checkLocalModel, downloadLocalModel, type LocalModel } from '../local-model';

const POLL_MS = 2_000;

export class LocalModelWatch {
  /** Null until Chrome has answered the first time. */
  model = $state<LocalModel | null>(null);
  /** Download progress from 0 to 1, while this page runs the download. */
  progress = $state<number | null>(null);
  /** Why the last download failed. */
  error = $state<string | null>(null);
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  /** Starts watching. Returns a function that stops it. */
  start(): () => void {
    this.#stopped = false;
    void this.refresh();
    return () => {
      this.#stopped = true;
      clearTimeout(this.#timer);
    };
  }

  async refresh(): Promise<LocalModel> {
    const model = await checkLocalModel();
    // A running download reports its own progress; don't let a poll undo it.
    if (this.progress === null || model.state === 'available') this.model = model;
    clearTimeout(this.#timer);
    if (!this.#stopped && (model.state === 'downloadable' || model.state === 'downloading')) {
      this.#timer = setTimeout(() => void this.refresh(), POLL_MS);
    }
    return model;
  }

  /** Starts the download. Call it from a click: Chrome needs the viewer's interaction with this page. */
  async download(): Promise<void> {
    this.error = null;
    this.progress = 0;
    this.model = { state: 'downloading' };
    try {
      await downloadLocalModel((fraction) => (this.progress = Math.max(this.progress ?? 0, fraction)));
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.progress = null;
      await this.refresh();
    }
  }
}
