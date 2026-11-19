// The MBFC ratings snapshot (drmikecrowe/mbfcext), taken at build time by
// scripts/mbfc-snapshot.ts and bundled. Nothing is looked up at runtime. This
// file has its shape and the lookup of a link in it.

/** MBFC's bias categories, as normalised by the snapshot step. */
export type MbfcBiasKey =
  | 'left'
  | 'left-center'
  | 'center'
  | 'right-center'
  | 'right'
  | 'pro-science'
  | 'conspiracy'
  | 'fake-news'
  | 'satire';

/** MBFC's factual reporting, upper case (the reliability rating). */
export type MbfcReporting = 'VERY HIGH' | 'HIGH' | 'MOSTLY FACTUAL' | 'MIXED' | 'LOW' | 'VERY LOW' | 'FAKE';

export interface MbfcEntry {
  b: MbfcBiasKey;
  /** Null when MBFC gives no factual-reporting value. */
  r: MbfcReporting | null;
  /** The outlet's MBFC page, or null when the data's link isn't one. */
  u: string | null;
  /** MBFC's name for the outlet. */
  n: string;
}

export interface RatingsSnapshot {
  /** Where the snapshot came from: the repo, the pinned commit and the file. */
  source: { repo: string; commit: string; path: string; url: string };
  /** The date of the pinned commit, YYYY-MM-DD. */
  snapshotDate: string;
  /** When the file itself last changed upstream, YYYY-MM-DD. */
  dataUpdated: string;
  aliases: Record<string, string>;
  /** Keyed by domain, a few by domain and path (`cato.org/regulation`). */
  ratings: Record<string, MbfcEntry>;
}

/** A link's host, lower case and without `www.`, and its path segments. */
export interface Place {
  host: string;
  path: string[];
}

export function placeOf(url: string): Place | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\d?\./, '');
    return { host, path: u.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase()) };
  } catch {
    return null;
  }
}

/** The host and each parent domain in turn, longest first, down to two labels (`a.b.c.com` → `b.c.com` → `c.com`). */
export function hostAndParents(host: string): string[] {
  const labels = host.split('.');
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
  return out.length > 0 ? out : [host];
}

/**
 * MBFC's rating for a link: the longest `domain/path` key that prefixes it,
 * then the domain, then its alias, walking up through parent domains. Parents
 * are tried one label at a time (never "the last two labels"), so a spoof
 * like `abcnews.com.co` keeps its own rating.
 */
export function lookupMbfc(snapshot: RatingsSnapshot, place: Place): MbfcEntry | null {
  for (const domain of hostAndParents(place.host)) {
    for (let depth = Math.min(place.path.length, 3); depth > 0; depth--) {
      const keyed = snapshot.ratings[`${domain}/${place.path.slice(0, depth).join('/')}`];
      if (keyed) return keyed;
    }
    const direct = snapshot.ratings[domain];
    if (direct) return direct;
    const alias = snapshot.aliases[domain];
    if (alias && snapshot.ratings[alias]) return snapshot.ratings[alias];
  }
  return null;
}
