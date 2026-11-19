// The bundled domain lists: primary sources, user-generated platforms and
// partisan sites. A rule matches its domain and every subdomain of it; a rule
// written `*.example.gov` matches only subdomains. When several rules match,
// the most specific wins: `clerk.house.gov` (primary) over `*.house.gov`
// (partisan: members' and committees' sites) over `house.gov` (primary).
//
// These lists override MBFC: MBFC rates whitehouse.gov as an outlet, but it is
// a political office's site; house.gov and cbo.gov are primary sources.
//
// Hand-written for ClaimCatcher (no third-party data). Add to them freely;
// sources.test.ts covers how each kind is treated, not the full contents.
// Hosts arrive without `www.`, so rules never carry it.

export type ListKind = 'primary' | 'user-generated' | 'partisan';

/** Official data agencies, courts, legislatures and academic journals. Every `.edu` site counts too (see `classify.ts`). */
export const PRIMARY: readonly string[] = [
  // US statistical and data agencies
  'bls.gov',
  'census.gov',
  'bea.gov',
  'cbo.gov',
  'gao.gov',
  'crsreports.congress.gov',
  'federalreserve.gov',
  'stlouisfed.org',
  'newyorkfed.org',
  'eia.gov',
  'nces.ed.gov',
  'bjs.ojp.gov',
  'cde.ucr.cjis.gov',
  'fbi.gov',
  'cdc.gov',
  'nih.gov',
  'fda.gov',
  'cms.gov',
  'ssa.gov',
  'ers.usda.gov',
  'nass.usda.gov',
  'fiscaldata.treasury.gov',
  'treasurydirect.gov',
  'irs.gov',
  'dol.gov',
  'ohss.dhs.gov',
  'noaa.gov',
  'nasa.gov',
  'usgs.gov',
  'epa.gov',
  'sec.gov',
  'fec.gov',
  'data.gov',
  'usaspending.gov',
  'govinfo.gov',
  'federalregister.gov',
  'ecfr.gov',
  'archives.gov',
  // Courts
  'supremecourt.gov',
  'uscourts.gov',
  'ussc.gov',
  'courtlistener.com',
  // Legislatures and their records (members' and committees' sites are partisan, below)
  'congress.gov',
  'house.gov',
  'clerk.house.gov',
  'docs.house.gov',
  'history.house.gov',
  'uscode.house.gov',
  'senate.gov',
  'ncsl.org',
  // International official statistics
  'imf.org',
  'worldbank.org',
  'oecd.org',
  'who.int',
  'un.org',
  'ec.europa.eu',
  'ons.gov.uk',
  'statcan.gc.ca',
  'abs.gov.au',
  // Academic journals and their publishers' journal hosts
  'nature.com',
  'science.org',
  'thelancet.com',
  'nejm.org',
  'jamanetwork.com',
  'bmj.com',
  'cell.com',
  'pnas.org',
  'plos.org',
  'sciencedirect.com',
  'link.springer.com',
  'onlinelibrary.wiley.com',
  'tandfonline.com',
  'academic.oup.com',
  'journals.sagepub.com',
  'journals.uchicago.edu',
  'aeaweb.org',
  'annualreviews.org',
  'jstor.org',
];

/** Social and video platforms: posts there are never evidence. */
export const USER_GENERATED: readonly string[] = [
  'x.com',
  'twitter.com',
  't.co',
  'facebook.com',
  'fb.com',
  'fb.watch',
  'instagram.com',
  'threads.net',
  'threads.com',
  'tiktok.com',
  'reddit.com',
  'redd.it',
  'youtube.com',
  'youtu.be',
  'rumble.com',
  'bitchute.com',
  'odysee.com',
  'truthsocial.com',
  'gab.com',
  'gettr.com',
  'parler.com',
  'bsky.app',
  'mastodon.social',
  'linkedin.com',
  'pinterest.com',
  'tumblr.com',
  'quora.com',
  'snapchat.com',
  'twitch.tv',
  'kick.com',
  'vimeo.com',
  'dailymotion.com',
  't.me',
  'telegram.org',
  'discord.com',
  'vk.com',
  'weibo.com',
  '4chan.org',
];

/** Campaign, party and political-office sites: shown for context, never evidence. */
export const PARTISAN: readonly string[] = [
  // Political offices
  'whitehouse.gov',
  '*.house.gov', // members, committees, party conferences
  '*.senate.gov',
  'speaker.gov',
  'democraticleader.gov',
  'republicanleader.gov',
  'majorityleader.gov',
  'gop.gov',
  'dems.gov',
  // Parties and their committees
  'gop.com',
  'democrats.org',
  'dccc.org',
  'nrcc.org',
  'dscc.org',
  'nrsc.org',
  'democraticgovernors.org',
  'rga.org',
  'dlcc.org',
  'rslc.gop',
  'lp.org',
  'gp.org',
  // Campaigns and fundraising
  'actblue.com',
  'winred.com',
  'donaldjtrump.com',
  'kamalaharris.com',
  'joebiden.com',
  'jdvance.com',
  'timwalz.com',
];

const RULES: ReadonlyArray<readonly [string, ListKind]> = [
  ...PRIMARY.map((d) => [d, 'primary'] as const),
  ...USER_GENERATED.map((d) => [d, 'user-generated'] as const),
  ...PARTISAN.map((d) => [d, 'partisan'] as const),
];

const BY_RULE = new Map<string, ListKind>(RULES.map(([rule, kind]) => [rule, kind]));

/** Which list a host is on, if any (the most specific rule wins). */
export function listOf(host: string): ListKind | null {
  const labels = host.split('.');
  for (let i = 0; i < labels.length; i++) {
    const domain = labels.slice(i).join('.');
    // `*.domain` covers this host only when it is a subdomain of `domain`.
    const wildcard = i > 0 ? BY_RULE.get(`*.${domain}`) : undefined;
    if (wildcard) return wildcard;
    const plain = BY_RULE.get(domain);
    if (plain) return plain;
  }
  return null;
}
