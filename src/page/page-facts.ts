// What the listened page says about its video, read once when listening
// starts. Runs in the tab through `scripting.executeScript({ func })` under the
// icon click's activeTab grant, so it must be self-contained: no imports, no
// outside names. The session finds the names on the page in what this reads.

export interface PageFacts {
  /** The video's title, without the site's " - YouTube" (see PageContext.title). */
  title?: string;
  /** The channel or uploader (see PageContext.channel). */
  channel?: string;
  /** The video's description, at most DESCRIPTION_LIMIT characters (see PageContext.description). */
  description?: string;
  /** When the video was recorded, YYYY-MM-DD (see PageContext.recordedOn). */
  recordedOn?: string;
}

/** The longest description kept: enough for the names in it, never a whole page. */
export const DESCRIPTION_LIMIT = 3000;

/**
 * Reads what the page says about its video. YouTube's watch page is read
 * from its live markup first (current after it navigates in place), then
 * from what every page may carry: schema.org VideoObject data (meta
 * `itemprop` tags and JSON-LD, as YouTube gives it) and Open Graph / meta tags.
 *
 * - title: the YouTube heading, `og:title`, the VideoObject's name, then the
 *   tab's title less a trailing " - YouTube";
 * - channel: the YouTube owner's name, the VideoObject author's name, then
 *   `meta[name=author]`;
 * - description: the longest of the YouTube description's own text (not the
 *   box around it), the VideoObject's, `og:description` and
 *   `meta[name=description]`, with its line breaks;
 * - recorded on: a live broadcast's start date first, then the upload date,
 *   then the publish date; a moment written in UTC is dated in the viewer's
 *   time zone, any other date is taken as written.
 */
export function readPageFacts(): PageFacts {
  const LIMIT = 3000; // DESCRIPTION_LIMIT: this function can't see outside names
  // A moment written in UTC ("2025-03-05T02:00:26+00:00", YouTube's live
  // start) is dated where the viewer is: a 9 p.m. ET stream is the 4th, not
  // UTC's 5th. Any other date is taken as written, in its own time zone (YouTube
  // writes upload dates in Pacific time).
  const day = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const written = /^\s*(\d{4}-\d{2}-\d{2})(T[\d:.]+(Z|[+-]00:?00))?/.exec(value);
    if (!written) return undefined;
    const at = written[2] ? new Date(value.trim()) : null;
    if (!at || Number.isNaN(at.getTime())) return written[1];
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  };
  const meta = (selector: string) => day(document.querySelector(selector)?.getAttribute('content'));
  const clean = (value: unknown): string | undefined => {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return text || undefined;
  };
  // A description keeps its line breaks: a name never runs on across one.
  const lines = (value: unknown): string | undefined => {
    const text = typeof value === 'string' ? value.replace(/[^\S\n]+/g, ' ').replace(/ *\n[\n ]*/g, '\n').trim() : '';
    return text || undefined;
  };
  const textOf = (selector: string) => clean(document.querySelector(selector)?.textContent);
  const contentOf = (selector: string) => clean(document.querySelector(selector)?.getAttribute('content'));

  const videos: Array<Record<string, unknown>> = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data: unknown = JSON.parse(script.textContent ?? '');
      const items = [data].flat().flatMap((item) => {
        const graph = (item as { '@graph'?: unknown } | null)?.['@graph'];
        return Array.isArray(graph) ? [item, ...graph] : [item];
      });
      for (const item of items) {
        if (item && typeof item === 'object' && (item as { '@type'?: unknown })['@type'] === 'VideoObject') {
          videos.push(item as Record<string, unknown>);
        }
      }
    } catch {
      // Not JSON: not ours to read.
    }
  }
  const linked = (read: (video: Record<string, unknown>) => unknown) => videos.map((v) => day(read(v))).find(Boolean);

  const nameOf = (value: unknown): string | undefined =>
    clean(typeof value === 'string' ? value : (value as { name?: unknown } | null)?.name);
  const video = videos[0];

  const title =
    textOf('ytd-watch-metadata h1') ??
    contentOf('meta[property="og:title"]') ??
    contentOf('[itemtype*="VideoObject"] meta[itemprop="name"]') ??
    nameOf(video?.name) ??
    clean(document.title.replace(/\s+-\s+YouTube$/, ''));
  const channel =
    textOf('ytd-watch-metadata ytd-channel-name a') ??
    textOf('#owner #channel-name a') ??
    contentOf('[itemprop="author"] [itemprop="name"]') ??
    nameOf([video?.author].flat()[0]) ??
    contentOf('meta[name="author"]');
  // YouTube's description text only: the box around it also holds "…more",
  // "Show less" and the transcript and channel sections ("Transcript Follow
  // along using the transcript"), which aren't the video's description.
  const descriptions = [
    lines(document.querySelector('ytd-watch-metadata ytd-text-inline-expander #attributed-snippet-text')?.textContent),
    lines(document.querySelector('ytd-text-inline-expander #attributed-snippet-text')?.textContent),
    contentOf('[itemtype*="VideoObject"] meta[itemprop="description"]'),
    lines(video?.description),
    contentOf('meta[property="og:description"]'),
    contentOf('meta[name="description"]'),
  ].filter((d): d is string => !!d);
  const description = descriptions.sort((a, b) => b.length - a.length)[0]?.slice(0, LIMIT);

  const recordedOn =
    meta('[itemprop="publication"] meta[itemprop="startDate"]') ??
    linked((v) => (v.publication as { startDate?: unknown } | undefined)?.startDate) ??
    meta('meta[itemprop="uploadDate"]') ??
    linked((v) => v.uploadDate) ??
    meta('meta[itemprop="datePublished"]') ??
    linked((v) => v.datePublished);
  return {
    ...(title ? { title } : {}),
    ...(channel ? { channel } : {}),
    ...(description ? { description } : {}),
    ...(recordedOn ? { recordedOn } : {}),
  };
}
