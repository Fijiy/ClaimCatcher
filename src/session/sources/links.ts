// Link cleaning (spec "Sources: Links"): every search result's link is
// cleaned before it is classified or shown.
//
// - Redirect wrappers that carry the final URL inside them (Google's /url,
//   Facebook's l.php, Outlook safe links, AMP caches, a `url=` parameter on a
//   redirect endpoint…) are unwrapped, as often as they nest.
// - Tracking parameters (`utm_*`, click ids, mailing-list ids…) are stripped.
//   Every other parameter keeps its exact encoding.
// - Nothing is ever fetched: a shortened link whose final URL isn't in the
//   link itself (bit.ly, t.co) stays as it is. ClaimCatcher has no host
//   permissions to follow redirects, and wouldn't use them for this.
// - Only http(s) links survive.

export interface CleanLink {
  url: string;
  /** The final link's host without `www.`: the domain the card shows. */
  domain: string;
}

/** Wrappers deeper than this are left as they are. */
const MAX_UNWRAP = 5;

const TRACKING = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'li_fat_id',
  'igshid',
  'igsh',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  '__hstc',
  '__hssc',
  '__hsfp',
  'hsctatracking',
  'mkt_tok',
  'oly_anon_id',
  'oly_enc_id',
  'vero_id',
  'vero_conv',
  'rb_clickid',
  's_cid',
  'wt.mc_id',
  'ocid',
  'cmpid',
  'ncid',
  'sr_share',
  'ref_src',
  'ref_url',
  'spm',
  'at_medium',
  'at_campaign',
  'ss_source',
  'ss_campaign_id',
  'xtor',
  'smid',
  'smtyp',
  'guccounter',
  'guce_referrer',
  'guce_referrer_sig',
  'fb_action_ids',
  'fb_action_types',
  'fb_source',
  'fb_ref',
]);

function isTracking(name: string): boolean {
  const key = name.toLowerCase();
  return key.startsWith('utm_') || TRACKING.has(key);
}

/** Known wrappers: the host, the path, and the parameters that carry the final URL. */
const WRAPPERS: Array<{ host: RegExp; path: RegExp; params: string[] }> = [
  { host: /^(www\.)?google\.[a-z.]+$/, path: /^\/url$/, params: ['q', 'url'] },
  { host: /^(l|lm)\.facebook\.com$|^l\.messenger\.com$/, path: /^\/l\.php$/, params: ['u'] },
  { host: /^l\.instagram\.com$/, path: /^\/?$/, params: ['u'] },
  { host: /^(www\.|m\.)?youtube\.com$/, path: /^\/redirect$/, params: ['q'] },
  { host: /^(html\.)?duckduckgo\.com$/, path: /^\/l\/?$/, params: ['uddg'] },
  { host: /(^|\.)safelinks\.protection\.outlook\.com$/, path: /^\/?$/, params: ['url'] },
  { host: /^out\.reddit\.com$/, path: /.*/, params: ['url'] },
  { host: /^(www\.)?linkedin\.com$/, path: /^\/(redir\/redirect|safety\/go)\/?$/, params: ['url'] },
  { host: /^slack-redir\.net$/, path: /^\/link$/, params: ['url'] },
  { host: /^t\.umblr\.com$/, path: /^\/redirect$/, params: ['z'] },
];

/** A path ending like this is a redirect endpoint on any site (`/redirect?to=…`, `/out?url=…`). */
const REDIRECT_ENDPOINT = /^(url|redirect|redir|out|outbound|outgoing|l|l\.php|link|go|goto|away|exit|click|r|leave|external)(\.\w+)?$/i;
const REDIRECT_PARAMS = ['url', 'u', 'q', 'uddg', 'dest', 'destination', 'target', 'to', 'goto', 'link', 'out', 'redirect', 'redirect_url', 'redirect_uri'];

/** The cleaned link, or null when it isn't an http(s) link. Never makes a request. */
export function cleanLink(link: string): CleanLink | null {
  let url = webUrl(link);
  if (!url) return null;
  for (let i = 0; i < MAX_UNWRAP; i++) {
    const inner = unwrap(url);
    if (!inner) break;
    url = inner;
  }
  url.search = withoutTracking(url.search);
  return { url: url.href, domain: url.hostname.replace(/^www\./, '') };
}

function webUrl(text: string): URL | null {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** The URL a wrapper carries, or null when `url` isn't a wrapper. */
function unwrap(url: URL): URL | null {
  const host = url.hostname.toLowerCase();

  // AMP caches carry the page in the path: google.com/amp/s/<host>/<path>, <x>.cdn.ampproject.org/c/s/<host>/<path>.
  const amp =
    (/^(www\.)?google\.[a-z.]+$/.test(host) && /^\/amp\/(s\/)?(.+)$/.exec(url.pathname)) ||
    (host.endsWith('.cdn.ampproject.org') && /^\/[cv]\/(s\/)?(.+)$/.exec(url.pathname));
  if (amp) return webUrl(`${amp[1] ? 'https' : 'http'}://${amp[2]}${url.search}`);

  // Bing's /ck/a carries the final URL base64url-encoded in `u`, after "a1".
  if (/^(www\.)?bing\.com$/.test(host) && url.pathname === '/ck/a') {
    const u = url.searchParams.get('u');
    if (u?.startsWith('a1')) return webUrl(fromBase64Url(u.slice(2)));
  }

  const known = WRAPPERS.find((w) => w.host.test(host) && w.path.test(url.pathname));
  const lastSegment = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const params = known?.params ?? (REDIRECT_ENDPOINT.test(lastSegment) ? REDIRECT_PARAMS : []);
  for (const name of params) {
    const value = url.searchParams.get(name);
    const inner = value ? webUrl(value) : null;
    if (inner) return inner;
  }
  return null;
}

function fromBase64Url(text: string): string {
  try {
    return atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return '';
  }
}

/** The query string without tracking parameters; the others keep their exact text. */
function withoutTracking(search: string): string {
  if (!search) return search;
  const kept = search
    .slice(1)
    .split('&')
    .filter((pair) => {
      if (!pair) return false;
      const name = pair.split('=')[0]!;
      try {
        return !isTracking(decodeURIComponent(name.replace(/\+/g, ' ')));
      } catch {
        return true;
      }
    });
  return kept.length > 0 ? `?${kept.join('&')}` : '';
}
