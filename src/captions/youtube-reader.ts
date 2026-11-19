// The YouTube caption reader: follows the on-screen `.ytp-caption-segment`
// overlay (YouTube's <video> has no textTracks). One of exactly three readers.
//
// Runs in the page (ISOLATED world). It turns the player's captions on if
// they are off, and hands the setting back when it stops. The overlay is a
// rolling window, so `createYouTubeCaptions` keeps each word once; this file
// only feeds it what is on screen and the media clock.

import type { CaptionSegment } from '../session/types';
import { createYouTubeCaptions } from './youtube-captions';

const PLAYER = '#movie_player, .html5-video-player';
const CAPTIONS = '.ytp-caption-window-container';
const SEGMENT = '.ytp-caption-segment';
const CC_BUTTON = '.ytp-subtitles-button';

/** Starts reading. Returns a function that stops, closes the open line and detaches everything. */
export function readYouTubeCaptions(doc: Document, onSegment: (segment: CaptionSegment) => void): () => void {
  const player = () => doc.querySelector<HTMLElement>(PLAYER);
  const video = () => player()?.querySelector('video') ?? doc.querySelector('video');
  // Live streams get the `ytp-live` class; their duration isn't finite while live.
  const live = () => Boolean(player()?.classList.contains('ytp-live')) || video()?.duration === Infinity;
  const captions = createYouTubeCaptions({ live });
  const emit = (segments: CaptionSegment[]) => segments.forEach(onSegment);

  let turnedCaptionsOn = false;
  let triedCaptions = false;
  function captionsOn() {
    const button = doc.querySelector<HTMLElement>(CC_BUTTON);
    if (!button) return;
    triedCaptions = true;
    if (button.getAttribute('aria-pressed') === 'false' && button.getAttribute('aria-disabled') !== 'true') {
      button.click();
      turnedCaptionsOn = true;
    }
  }

  function read() {
    const media = video();
    if (!media) return;
    const text = [...doc.querySelectorAll(SEGMENT)]
      .map((node) => node.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
    emit(captions.update(text, media.currentTime));
  }

  // Only mutations inside the caption window matter; YouTube changes plenty else.
  const inCaptions = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement;
    return Boolean(element?.closest(CAPTIONS));
  };
  const observer = new MutationObserver((records) => {
    if (!triedCaptions) captionsOn();
    if (records.some((r) => inCaptions(r.target))) read();
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });

  // The media clock closes a line when the speaker pauses. `timeupdate`
  // doesn't bubble, so listen in the capture phase.
  const onTimeUpdate = (event: Event) => {
    if (event.target === video()) emit(captions.tick((event.target as HTMLMediaElement).currentTime));
  };
  doc.addEventListener('timeupdate', onTimeUpdate, true);

  captionsOn();
  read();

  return () => {
    observer.disconnect();
    doc.removeEventListener('timeupdate', onTimeUpdate, true);
    emit(captions.flush());
    const button = doc.querySelector<HTMLElement>(CC_BUTTON);
    if (turnedCaptionsOn && button?.getAttribute('aria-pressed') === 'true') button.click();
  };
}
