// Turns a rolling caption window into timed lines, each word once.
//
// Caption overlays don't hand out cues: they show a window of text that grows
// and scrolls. YouTube's auto captions append a word at a time and drop the
// top line when it fills; broadcast tracks grow letter by letter
// ("BACK T" -> "BACK TO"); live captions replace a phrase at a time. Each
// snapshot of the window is matched against the tail of the words already
// taken (the longest tail that starts the snapshot), and only what follows is
// new. That is the `new_words` method from task/site-capture-test, with the
// growing last word tolerated.
//
// Words are held until something closes them: a sentence end once another
// word follows it (so "U.S" can still become "U.S."), a pause in the media,
// the window clearing, a line growing too long, or `flush`.

export interface RollingLine {
  /** Media time the line's first word appeared, in seconds. */
  start: number;
  /** Media time the line's last word appeared, in seconds. */
  end: number;
  text: string;
}

export interface RollingLinesOptions {
  /** Media seconds without a new word that close the open line. */
  pauseSeconds?: number;
  /** Words that close a line even without a sentence end. */
  maxWords?: number;
}

export interface RollingLines {
  /** The text on screen at media time `time`. Returns the lines it closed. */
  update(text: string, time: number): RollingLine[];
  /** The media clock moved on to `time` (e.g. `timeupdate`). Returns lines a pause closed. */
  tick(time: number): RollingLine[];
  /** Closes whatever is open (listening stopped). */
  flush(): RollingLine[];
}

interface Word {
  text: string;
  time: number;
}

/** How many recent words a new snapshot is matched against; well over a window's worth. */
const TAIL = 80;

export function createRollingLines(options: RollingLinesOptions = {}): RollingLines {
  const pauseSeconds = options.pauseSeconds ?? 2;
  const maxWords = options.maxWords ?? 30;
  let tail: string[] = []; // the last words taken, closed or not
  let open: Word[] = []; // words not yet in a line
  let lastText = '';
  let lastChange = -Infinity;

  function take(words: string[], time: number) {
    const overlap = overlapLength(tail, words);
    if (overlap > 0) {
      // A growing last word ("BACK T" -> "BACK TO") replaces itself.
      const grown = words[overlap - 1]!;
      if (tail.at(-1) !== grown) {
        tail[tail.length - 1] = grown;
        const last = open.at(-1);
        if (last) last.text = grown;
        lastChange = time;
      }
    }
    const fresh = words.slice(overlap);
    if (fresh.length > 0) lastChange = time;
    for (const text of fresh) open.push({ text, time });
    tail = [...tail, ...fresh].slice(-TAIL);
  }

  /** Closes the open words up to and including index `end`. */
  function close(end: number): RollingLine {
    const words = open.splice(0, end + 1);
    return { start: words[0]!.time, end: words.at(-1)!.time, text: words.map((w) => w.text).join(' ') };
  }

  /** Lines closed by sentence ends (followed by another word) and by length. */
  function closeFinished(): RollingLine[] {
    const lines: RollingLine[] = [];
    for (let i = 0; i < open.length - 1; ) {
      if (endsSentence(open[i]!.text)) {
        lines.push(close(i));
        i = 0;
      } else i++;
    }
    while (open.length > maxWords) lines.push(close(maxWords - 1));
    return lines;
  }

  function flush(): RollingLine[] {
    return open.length > 0 ? [close(open.length - 1)] : [];
  }

  function tick(time: number): RollingLine[] {
    return time - lastChange >= pauseSeconds ? flush() : [];
  }

  return {
    update(text, time) {
      const clean = text.replace(/\s+/g, ' ').trim();
      const paused = tick(time); // a pause since the last word closes the line first
      if (clean === lastText) return paused;
      lastText = clean;
      if (!clean) return [...paused, ...flush()]; // the window cleared: the speaker paused
      take(clean.split(' '), time);
      return [...paused, ...closeFinished()];
    },
    tick,
    flush,
  };
}

/**
 * The length of the longest run of words that ends `tail` and starts `words`.
 * The last word of the run may have grown since (`tail` ends "T", `words` has "TO").
 */
function overlapLength(tail: string[], words: string[]): number {
  for (let k = Math.min(tail.length, words.length); k > 0; k--) {
    let match = true;
    for (let i = 0; i < k && match; i++) {
      const before = norm(tail[tail.length - k + i]!);
      const now = norm(words[i]!);
      match = i === k - 1 ? now.startsWith(before) : now === before;
    }
    if (match) return k;
  }
  return 0;
}

function norm(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}'$%]/gu, '');
}

const ABBREVIATION = /^(mr|mrs|ms|dr|st|jr|sr|vs|gov|sen|rep|gen|no)\.$|^(\p{L}\.){2,}$/iu;

function endsSentence(word: string): boolean {
  return /[.?!]["'”’)]*$/u.test(word) && !ABBREVIATION.test(word);
}
