// The speaker gate (spec "Steps for each sentence", 3): who said a claim that
// depends on the speaker, and the names "Who said this?" offers.
//
// A speaker comes from the viewer (or a voice the viewer named), or from the
// page: breakdown may name one from the title and channel, but that name is
// trusted only if those details name it and no one else. Anything breakdown
// could only have taken from what was said is dropped, so a claim is never
// pinned on a guess (spec story 52). All of this runs on the device.

import type { PageContext } from '../types';

/** At most this many names are offered as buttons. */
const MAX_NAMES = 6;

/**
 * The speaker breakdown named, if the page settles it: the name's surname is
 * written in the details breakdown was shown (title and channel, and the
 * description for an on-device model), and those details name no one else,
 * by breakdown's own list or by the names found here. Otherwise null.
 */
export function speakerFromPage(name: string | null, peopleNamed: string[], page: PageContext, onDevice: boolean): string | null {
  const said = name?.trim();
  if (!said) return null;
  const shown = [page.title, page.channel ?? '', onDevice ? (page.description ?? '') : ''];
  const surname = surnameOf(said);
  if (!surname || !shown.some((text) => hasWord(text, surname))) return null;
  // Everyone the title and channel name (a debate's title names both sides). Breakdown's list
  // counts only for names written there: a small model also lists people the sentence names.
  const titled = [page.title, page.channel ?? ''];
  const listed = peopleNamed.filter((person) => titled.some((text) => hasWord(text, surnameOf(person))));
  const people = mergeNames([...listed, ...namesIn(page.title), ...namesIn(page.channel ?? '')]);
  const others = people.filter((person) => surnameOf(person) !== surname);
  return others.length === 0 ? said : null;
}

/**
 * The one person the page names, if it names exactly one (#36's rule): the
 * title and channel name one surname and no other. Their longest form is
 * taken from the title and channel, and, for an on-device model, the
 * description ("Trump" in the title, "Donald J. Trump" in the description).
 * Null when they name no one, or more than one person. Never a guess from
 * what was said.
 */
export function pageSpeaker(page: PageContext, onDevice: boolean): string | null {
  const named = mergeNames([...namesIn(page.title), ...namesIn(page.channel ?? '')]);
  if (named.length !== 1) return null;
  const surname = surnameOf(named[0]!);
  const forms = [named[0]!, ...(onDevice ? namesIn(page.description ?? '').filter((n) => surnameOf(n) === surname) : [])];
  return forms.reduce((a, b) => (b.split(' ').length > a.split(' ').length ? b : a));
}

/**
 * The names found on the page, for "Who said this?": people named in the
 * title, the channel and the description, in that order, with a surname
 * given twice ("Biden", "Joe Biden") kept once in its longest form.
 */
export function namesOnPage(page: PageContext): string[] {
  return mergeNames([...namesIn(page.title), ...namesIn(page.channel ?? ''), ...namesIn(page.description ?? '')]).slice(0, MAX_NAMES);
}

/** The words a card's conclusion quotes when it can't tell who is speaking. */
export function unresolvedConclusion(words: string | null): string {
  return `Can’t tell who “${words?.trim() || 'I'}” refers to, so this wasn’t checked.`;
}

/** A forced check's claim with words no one named: it isn't searched. */
export function unresolvedContext(words: string): string {
  return `Can’t tell who or what “${words.trim()}” refers to, so this wasn’t checked.`;
}

/** Merges names by surname, keeping the first one's place and the longest form. */
export function mergeNames(names: string[]): string[] {
  const merged: string[] = [];
  for (const raw of names) {
    const name = raw.replace(/\s+/g, ' ').trim();
    const surname = surnameOf(name);
    if (!surname) continue;
    const at = merged.findIndex((m) => surnameOf(m) === surname);
    if (at < 0) merged.push(name);
    else if (name.split(' ').length > merged[at]!.split(' ').length) merged[at] = name;
  }
  return merged;
}

function surnameOf(name: string): string {
  const words = name.toLowerCase().replace(/[’']s\b/g, '').match(/[\p{L}][\p{L}'’-]*/gu) ?? [];
  const last = words.filter((w) => !SUFFIXES.has(w)).at(-1) ?? '';
  return last.length >= 2 ? last : '';
}

function hasWord(text: string, word: string): boolean {
  return (text.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) ?? []).some((w) => w.replace(/[’']s$/, '') === word);
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

// ---- Finding names in text --------------------------------------------------

/** Titles that come before a name. A word after one of these is a name even on its own ("Senator Warren"). */
const TITLES = new Set(
  [
    'president', 'vice', 'former', 'senator', 'sen', 'representative', 'rep', 'congressman', 'congresswoman', 'governor', 'gov',
    'lt', 'lieutenant', 'mayor', 'speaker', 'leader', 'secretary', 'sec', 'chairman', 'chairwoman', 'chair', 'judge', 'justice',
    'attorney', 'general', 'ambassador', 'minister', 'prime', 'premier', 'commissioner', 'sheriff', 'councilmember',
    'councilman', 'councilwoman', 'dr', 'mr', 'mrs', 'ms', 'candidate', 'nominee', 'rev', 'pres',
  ],
);

/** Words that end an organisation's name: the capitalised words before one are not a person ("Ohio Public Media"). */
const ORGANISATION_ENDS = new Set(
  [
    'news', 'network', 'channel', 'tv', 'radio', 'media', 'studio', 'studios', 'podcast', 'committee', 'subcommittee', 'party',
    'university', 'college', 'school', 'court', 'department', 'office', 'agency', 'bureau', 'times', 'post', 'journal',
    'tribune', 'foundation', 'institute', 'center', 'centre', 'council', 'association', 'group', 'caucus', 'campaign', 'pac',
  ],
);

/** Capitalised words that are never part of a person's name in a video's details. */
const NOT_NAMES = new Set(
  [
    ...ORGANISATION_ENDS,
    'the', 'a', 'an', 'of', 'for', 'on', 'in', 'at', 'to', 'with', 'from', 'by', 'and', 'or', 'vs', 'versus', 'v', 'is', 'are',
    'i', 'we', 'my', 'our', 'his', 'her', 'their', 'this', 'that', 'these', 'here', 'why', 'how', 'what', 'when', 'where', 'who',
    'watch', 'live', 'full', 'breaking', 'exclusive', 'official', 'video', 'new', 'latest', 'top', 'best',
    'news', 'network', 'channel', 'tv', 'radio', 'media', 'studio', 'studios', 'podcast', 'show', 'tonight', 'today',
    'debate', 'debates', 'speech', 'remarks', 'hearing', 'interview', 'town', 'hall', 'press', 'conference', 'briefing',
    'address', 'statement', 'rally', 'campaign', 'convention', 'summit', 'forum', 'panel', 'session', 'meeting', 'event',
    'highlights', 'moments', 'clip', 'clips', 'part', 'episode', 'segment', 'recap', 'replay', 'update', 'report', 'special',
    'house', 'senate', 'congress', 'committee', 'subcommittee', 'floor', 'chamber', 'party', 'republican', 'republicans',
    'democrat', 'democrats', 'democratic', 'gop', 'independent', 'white', 'united', 'states', 'state', 'america', 'american',
    'americans', 'nation', 'national', 'federal', 'government', 'administration', 'department', 'office', 'agency', 'bureau',
    'capitol', 'union', 'university', 'college', 'school', 'court', 'supreme', 'county', 'city', 'presidential', 'vice-presidential',
    'act', 'bill', 'law', 'policy', 'economy', 'budget', 'tax', 'taxes', 'jobs', 'health', 'care', 'security', 'border',
    'day', 'night', 'morning', 'evening', 'week', 'weekly', 'daily', 'year', 'minutes', 'hour', 'face', 'meet',
    'fox', 'cnn', 'cbs', 'nbc', 'abc', 'pbs', 'npr', 'msnbc', 'cnbc', 'c-span', 'cspan', 'bbc', 'reuters', 'ap', 'times',
    'post', 'journal', 'tribune', 'youtube',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'joint', 'transcript', 'transcripts', 'follow', 'along', 'show', 'more', 'less', 'subscribe', 'subscribers', 'views',
    'streamed', 'premiered', 'videos', 'about', 'chapters', 'description', 'text', 'call', 'visit', 'watch', 'click',
    'read', 'learn', 'join', 'sign', 'download', 'shop', 'like', 'share', 'comment', 'comments',
  ],
);

/**
 * Verbs a Title Case heading puts after a name ("Trump Addresses Joint
 * Session"): they end the name, so a title word's run stops there.
 */
const HEADLINE_VERBS = new Set(
  [
    'addresses', 'address', 'delivers', 'deliver', 'gives', 'give', 'holds', 'hold', 'speaks', 'speak', 'signs', 'sign',
    'announces', 'announce', 'hosts', 'host', 'meets', 'meet', 'joins', 'join', 'visits', 'visit', 'talks', 'talk',
    'discusses', 'discuss', 'responds', 'respond', 'testifies', 'testify', 'makes', 'make', 'takes', 'take', 'says', 'say',
    'calls', 'call', 'slams', 'blasts', 'unveils', 'unveil', 'outlines', 'outline', 'rallies', 'rally', 'campaigns',
    'answers', 'answer', 'reacts', 'react', 'celebrates', 'honors', 'welcomes', 'welcome', 'debates', 'debate',
    'interviews', 'participates', 'remarks', 'touts', 'warns', 'urges', 'vows', 'defends', 'attacks', 'explains',
    'accepts', 'departs', 'arrives', 'returns', 'leads', 'lays', 'presents', 'introduces', 'launches', 'issues',
    'speech', 'address', 'swears', 'sworn', 'returns', 'goes', 'sits', 'stops', 'tours', 'greets', 'awards', 'marks',
    'attends', 'attend', 'participates', 'participate', 'questions', 'grills', 'presses', 'asks', 'confronts', 'spars', 'clashes', 'at', 'in', 'on', 'to', 'with', 'and', 'for', 'from',
  ],
);

/** Words that join two sides: a lone capitalised word next to one is a surname ("Harris vs. Trump"). */
const SIDES = /^(vs\.?|v\.|versus)$/i;

/** A period that doesn't end a phrase: after an initial or a title's abbreviation. */
const ABBREVIATED = /(?:^|[\s.])(?:[A-Z]|Sen|Rep|Gov|Pres|Sec|Lt|Gen|Dr|Mr|Mrs|Ms|Rev|Jr|Sr|St|vs|v)\.$/;

/**
 * People named in a piece of text. A run of two to four capitalised words is
 * a name; one word is a name after a title or beside "vs.". In Title Case
 * text, where every word is capitalised, only those two stronger signs count.
 */
export function namesIn(text: string): string[] {
  const names: string[] = [];
  // Title Case ("Biden Delivers Remarks on the Economy") is judged on the whole
  // text's longer words, as Title Case keeps short ones in lower case.
  const long = text.split(/\s+/).map((w) => w.replace(/^[^\p{L}]+/u, '')).filter((w) => /^\p{L}{4,}/u.test(w));
  const titleCase = long.length >= 3 && long.filter(isCapitalised).length / long.length >= 0.85;
  for (const phrase of phrases(text)) {
    const words = phrase.split(/\s+/).filter(Boolean);
    let run: string[] = [];
    let titled = false;
    let sideBefore = false;
    const close = (sideAfter: boolean) => {
      if (run.length > 0) {
        const strong = titled || sideBefore || sideAfter;
        if ((run.length === 1 && strong) || (run.length >= 2 && run.length <= 4 && (!titleCase || strong))) names.push(run.join(' '));
      }
      run = [];
      titled = false;
    };
    for (const raw of words) {
      const word = raw.replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, '').replace(/[’']s$/, '');
      const bare = word.replace(/\.$/, '').toLowerCase();
      if (SIDES.test(raw)) {
        close(true);
        sideBefore = true;
        continue;
      }
      // In a Title Case heading, a verb after the name ends it ("Trump Addresses Joint Session").
      if (titleCase && run.length > 0 && HEADLINE_VERBS.has(bare)) {
        close(false);
        sideBefore = false;
        continue;
      }
      if (TITLES.has(bare) && isCapitalised(word)) {
        close(false);
        titled = true;
        sideBefore = false;
        continue;
      }
      if (isCapitalised(word) && !NOT_NAMES.has(bare) && !isShouted(word)) {
        run.push(/^(?:\p{Lu}\.)+$/u.test(word) ? word : word.replace(/\.$/, ''));
        // A comma or a possessive ends the name ("Lopez's plan").
        if (/(?:[’']s|[,;])$/.test(raw)) {
          close(false);
          sideBefore = false;
        }
        continue;
      }
      if (isCapitalised(word) && ORGANISATION_ENDS.has(bare)) run = [];
      close(false);
      sideBefore = false;
    }
    close(false);
  }
  return names;
}

/** Splits text where a name can't run on: sentence ends, colons, brackets, quotes, dashes, pipes. */
function phrases(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.replace(/[!?|•·–—()[\]{}"“”/…]+|\s[-:]\s/g, '\n').split('\n')) {
    let current = '';
    for (const piece of chunk.split(/(\s+)/)) {
      current += piece;
      if (/[.:;]$/.test(piece) && !ABBREVIATED.test(current.trimEnd())) {
        out.push(current);
        current = '';
      }
    }
    out.push(current);
  }
  return out.map((p) => p.trim()).filter(Boolean);
}

function isCapitalised(word: string): boolean {
  return /^\p{Lu}/u.test(word);
}

/** ALL CAPS words (other than initials) can't be told apart from shouted titles. */
function isShouted(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3 && letters === letters.toUpperCase() && !/^(?:[A-Z]\.)+$/.test(word);
}
