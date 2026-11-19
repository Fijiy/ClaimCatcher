// Whether local mode can run here, and its one-time model download. Used by
// the extension's Window contexts only (the first-run page / Privacy & data,
// the side panel and the offscreen document): Chrome exposes `LanguageModel`
// to Windows, not to the service worker.
//
// Local mode is offered only in Google Chrome, and only when Chrome reports
// Gemini Nano as available or downloadable (Chrome enforces the hardware,
// disk and policy limits itself). Edge and Brave have `LanguageModel` too,
// backed by other models that never passed the quality gate, so the brand is
// checked, not just the API.

import { NANO_OPTIONS, type LanguageModelFactory, type NanoAvailability } from './session/checks/nano';

/** Local mode's state on this browser and device. */
export type LocalModel =
  /** Not Google Chrome (Edge, Brave, Chromium…): local mode can't be picked. */
  | { state: 'not-chrome' }
  /** Google Chrome, but it can't run Gemini Nano here (hardware, disk, policy, crashes). */
  | { state: 'unavailable' }
  | { state: Exclude<NanoAvailability, 'unavailable'> };

export const LOCAL_MODEL_TEXT = {
  notChrome: "Local mode needs Google Chrome's built-in model.",
  unavailable:
    "Local mode isn't available on this device: Chrome says its built-in model, Gemini Nano, can't run here. Chrome runs it " +
    'only on Windows 10 or 11, macOS 13 or later, Linux or a Chromebook Plus, with a graphics card with more than 4 GB of ' +
    'memory or 16 GB of RAM and 4 CPU cores, and with at least 22 GB of free disk space. An administrator can also turn it ' +
    'off, and Chrome turns it off for a while after it crashes several times.',
} as const;

/** Whether local mode can be chosen (it may still need its download). */
export function offersLocalMode(model: LocalModel): boolean {
  return model.state === 'available' || model.state === 'downloadable' || model.state === 'downloading';
}

/** Google Chrome itself, not another Chromium browser. */
export function isGoogleChrome(nav: Navigator = navigator): boolean {
  const brands = (nav as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands ?? [];
  return brands.some((b) => b.brand === 'Google Chrome') && !('brave' in nav);
}

/** Chrome's `LanguageModel`, in Google Chrome only; undefined anywhere else. */
export function chromeLanguageModel(scope: typeof globalThis = globalThis): LanguageModelFactory | undefined {
  if (!isGoogleChrome(scope.navigator)) return undefined;
  return (scope as typeof globalThis & { LanguageModel?: LanguageModelFactory }).LanguageModel;
}

export async function checkLocalModel(scope: typeof globalThis = globalThis): Promise<LocalModel> {
  if (!isGoogleChrome(scope.navigator)) return { state: 'not-chrome' };
  const factory = chromeLanguageModel(scope);
  if (!factory) return { state: 'unavailable' }; // turned off in this copy of Chrome
  try {
    const availability = await factory.availability(NANO_OPTIONS);
    return availability === 'unavailable' ? { state: 'unavailable' } : { state: availability };
  } catch {
    return { state: 'unavailable' };
  }
}

/**
 * Downloads Gemini Nano. Must run from a click in this page: Chrome starts the
 * download only for a page the viewer has interacted with (the offscreen
 * document never has). Reports progress from 0 to 1; resolves once the model
 * is ready. Chrome keeps downloading if the page closes.
 */
export async function downloadLocalModel(onProgress: (fraction: number) => void): Promise<void> {
  const factory = chromeLanguageModel();
  if (!factory) throw new Error(LOCAL_MODEL_TEXT.notChrome);
  const session = await factory.create({
    ...NANO_OPTIONS,
    monitor(monitor) {
      monitor.addEventListener('downloadprogress', (event) => onProgress((event as ProgressEvent).loaded));
    },
  });
  // Only the download was wanted; the offscreen document makes its own sessions.
  session.destroy();
}
