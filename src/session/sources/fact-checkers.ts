// Professional fact-checkers (spec "Sources"): a result from one of them is
// highlighted on the card ("PolitiFact rated this…"). It is still one source
// among the others, weighted by its reliability rating like any outlet, and
// the verdict is still ClaimCatcher's own. The Google Fact Check API is not
// used: this is a bundled list matched against each result's cleaned link.
//
// Whole sites are fact-checkers (most are IFCN signatories); a few newsrooms
// have a fact-check desk under a path of their own.

import { hostAndParents, placeOf } from './ratings';

const SITES: Record<string, string> = {
  'politifact.com': 'PolitiFact',
  'factcheck.org': 'FactCheck.org',
  'snopes.com': 'Snopes',
  'fullfact.org': 'Full Fact',
  'leadstories.com': 'Lead Stories',
  'checkyourfact.com': 'Check Your Fact',
  'truthorfiction.com': 'TruthOrFiction',
  'africacheck.org': 'Africa Check',
  'factcheck.afp.com': 'AFP Fact Check',
  'healthfeedback.org': 'Health Feedback',
  'sciencefeedback.co': 'Science Feedback',
  'climatefeedback.org': 'Climate Feedback',
  'factchecker.in': 'FactChecker.in',
  'boomlive.in': 'BOOM',
  'verafiles.org': 'VERA Files',
  'maldita.es': 'Maldita',
  'newtral.es': 'Newtral',
  'correctiv.org': 'CORRECTIV',
  'logically.ai': 'Logically Facts',
  'logicallyfacts.com': 'Logically Facts',
};

/** Newsroom fact-check desks: a path segment on the outlet's site that marks one. */
const DESKS: Record<string, { name: string; segment: (segment: string) => boolean }> = {
  'apnews.com': { name: 'AP Fact Check', segment: (s) => s === 'ap-fact-check' || s.startsWith('fact-check') },
  'reuters.com': { name: 'Reuters Fact Check', segment: (s) => s === 'fact-check' || s === 'factcheck' },
  'usatoday.com': { name: 'USA TODAY Fact Check', segment: (s) => s === 'factcheck' || s === 'fact-check' },
  'washingtonpost.com': { name: 'The Washington Post Fact Checker', segment: (s) => s === 'fact-checker' },
  'cnn.com': { name: 'CNN Fact Check', segment: (s) => s === 'fact-check' || s.startsWith('fact-check-') },
};

/** Which professional fact-checker published this link, or null. */
export function factCheckerOf(url: string): string | null {
  const place = placeOf(url);
  if (!place) return null;
  for (const domain of hostAndParents(place.host)) {
    const site = SITES[domain];
    if (site) return site;
    const desk = DESKS[domain];
    if (desk && place.path.some(desk.segment)) return desk.name;
  }
  return null;
}
