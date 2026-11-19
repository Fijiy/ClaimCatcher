// The generic caption reader: follows `<track>` / `textTracks` cues on every
// media element in a document. One of exactly three readers (spec, "Caption
// readers"); the YouTube and House readers sit beside it in this folder.
//
// Runs in the page (ISOLATED world), so it only reads the DOM and reports
// segments through `onSegment`; it knows nothing about messaging.

import type { CaptionSegment } from '../session/types';
import { CAPTION_LAG_SECONDS, shiftEarlier } from './lag';

/** Starts reading. Returns a function that stops reading and detaches everything. */
export function readTextTracks(doc: Document, onSegment: (segment: CaptionSegment) => void): () => void {
  const cleanups: Array<() => void> = [];
  const attached = new WeakSet<HTMLMediaElement>();
  const seen = new Set<string>();

  function report(cue: TextTrackCue) {
    const text = cueText(cue);
    if (!text) return;
    const key = `${cue.startTime}|${cue.endTime}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    onSegment(shiftEarlier({ reader: 'track', start: cue.startTime, end: cue.endTime, text }, CAPTION_LAG_SECONDS.track));
  }

  function follow(media: HTMLMediaElement) {
    const track = pickTrack(media.textTracks);
    if (!track || attached.has(media)) return;
    attached.add(media);
    // A disabled track loads no cues; "hidden" loads them without drawing them.
    if (track.mode === 'disabled') track.mode = 'hidden';
    const onCueChange = () => {
      const active = track.activeCues;
      for (let i = 0; active && i < active.length; i++) report(active[i]!);
    };
    track.addEventListener('cuechange', onCueChange);
    onCueChange();
    cleanups.push(() => track.removeEventListener('cuechange', onCueChange));
  }

  function watch(media: HTMLMediaElement) {
    follow(media);
    const onAddTrack = () => follow(media);
    media.textTracks.addEventListener('addtrack', onAddTrack);
    cleanups.push(() => media.textTracks.removeEventListener('addtrack', onAddTrack));
  }

  const watched = new WeakSet<HTMLMediaElement>();
  const scan = () => {
    for (const media of doc.querySelectorAll<HTMLMediaElement>('video, audio')) {
      if (watched.has(media)) continue;
      watched.add(media);
      watch(media);
    }
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  cleanups.push(() => observer.disconnect());

  return () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  };
}

/** The track to read: the one showing, else English, else the first captions or subtitles. */
function pickTrack(tracks: TextTrackList): TextTrack | undefined {
  const candidates: TextTrack[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]!;
    if (track.kind === 'captions' || track.kind === 'subtitles') candidates.push(track);
  }
  return (
    candidates.find((t) => t.mode === 'showing') ??
    candidates.find((t) => t.language.toLowerCase().startsWith('en')) ??
    candidates[0]
  );
}

/** A cue's plain text: WebVTT tags such as `<v Speaker>` removed, whitespace collapsed. */
function cueText(cue: TextTrackCue): string {
  // getCueAsHTML parses with WebVTT rules into inert nodes: no markup is run.
  const raw = cue instanceof VTTCue ? (cue.getCueAsHTML().textContent ?? '') : '';
  return raw.replace(/\s+/g, ' ').trim();
}
