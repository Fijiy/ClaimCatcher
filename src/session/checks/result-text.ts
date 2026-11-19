// Turning a search's results into plain `SearchResult` fields, for every
// search adapter (venice.ts, tinyfish.ts).

/** The result's host without `www.`; null for a link that isn't http(s). */
export function domainOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:' && protocol !== 'http:') return null;
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Search snippets carry `<strong>` highlights and HTML entities; make them plain text. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
