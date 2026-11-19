// Replay: seeks the listened video to a moment and plays it. Runs in the tab
// through `scripting.executeScript({ func, args })` under the activeTab grant
// the icon click gave, so it must be self-contained.

/** Seeks the page's main media element to `seconds` and plays. False if the page has none. */
export function seekMedia(seconds: number): boolean {
  const rank = (media: HTMLMediaElement) =>
    (media.played.length > 0 ? 4 : 0) + (media.readyState > 0 ? 2 : 0) + (media.clientWidth * media.clientHeight > 0 ? 1 : 0);
  const [media] = Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio')).sort((a, b) => rank(b) - rank(a));
  if (!media) return false;
  media.currentTime = Math.max(0, seconds);
  void media.play().catch(() => {});
  return true;
}
