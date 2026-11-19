// Before a blocked player's page is opened again in a new tab: pauses the
// page's main media element and says where it was, so the new tab can start
// at the same moment. Runs in the tab through `scripting.executeScript({ func })`
// under the icon click's activeTab grant, so it must be self-contained.

/** Pauses the page's main media element; its `currentTime`, or null if the page has none (an embed from another site). */
export function pauseMedia(): number | null {
  const rank = (media: HTMLMediaElement) =>
    (media.played.length > 0 ? 4 : 0) + (media.readyState > 0 ? 2 : 0) + (media.clientWidth * media.clientHeight > 0 ? 1 : 0);
  const [media] = Array.from(document.querySelectorAll<HTMLMediaElement>('video, audio')).sort((a, b) => rank(b) - rank(a));
  if (!media || !Number.isFinite(media.currentTime)) return null;
  media.pause();
  return media.currentTime;
}
