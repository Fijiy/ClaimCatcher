// Build step: takes a snapshot of the official MBFC extension's ratings
// (drmikecrowe/mbfcext) and writes it, normalised, to
// src/session/sources/mbfc-snapshot.json, which the extension bundles.
// Nothing is looked up at runtime.
//
// Runs on `pnpm install` and before every WXT build (wxt.config.ts). It only
// goes to the network when the file is missing or was taken from another
// source or commit than the one pinned below. `pnpm ratings` forces a refetch.
//
// The snapshot is not committed: MBFC's ratings aren't covered by the mbfcext
// repo's MIT licence (see the spec's Further Notes and the notices file).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'drmikecrowe/mbfcext';
/** The pinned commit. Bump it to take a newer snapshot. */
const COMMIT = '60b0390730c32f2f367c0e6a4834ade39670bdcf';

export const OUTPUT = fileURLToPath(new URL('../src/session/sources/mbfc-snapshot.json', import.meta.url));

/** The two shapes the mbfcext repo publishes. */
const SOURCES = {
  /** What the spec names: frozen since 2022, about 2,068 domains. */
  csources: { path: 'docs/csources.json', aliases: 'docs/aliases.json', normalise: fromCsources },
  /** What the live extension uses: updated daily, about 9,777 domains. */
  combined: { path: 'docs/v5/data/combined.json', aliases: null, normalise: fromCombined },
} as const;

/** Which file is bundled. Switching to `SOURCES.combined` is this one line (DECISIONS.md). */
const SOURCE = SOURCES.csources;

/** MBFC's bias categories, spelled one way. */
type BiasKey = 'left' | 'left-center' | 'center' | 'right-center' | 'right' | 'pro-science' | 'conspiracy' | 'fake-news' | 'satire';
/** MBFC's factual-reporting values, upper case. */
type Reporting = 'VERY HIGH' | 'HIGH' | 'MOSTLY FACTUAL' | 'MIXED' | 'LOW' | 'VERY LOW' | 'FAKE';

interface Entry {
  /** Bias category. */
  b: BiasKey;
  /** Factual reporting, the reliability rating; null when MBFC gives none. */
  r: Reporting | null;
  /** The outlet's MBFC page; null when the data's link isn't one. */
  u: string | null;
  /** MBFC's name for the outlet. */
  n: string;
}

export interface Snapshot {
  source: { repo: string; commit: string; path: string; url: string };
  /** The date of the pinned commit, YYYY-MM-DD: the snapshot is the file as of then. */
  snapshotDate: string;
  /** When the file itself last changed upstream, YYYY-MM-DD. */
  dataUpdated: string;
  /** Alternative domain → the domain it's rated under. */
  aliases: Record<string, string>;
  /** Domain, sometimes with a path (`cato.org/regulation`) → rating. */
  ratings: Record<string, Entry>;
}

const raw = (path: string) => `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${path}`;

/** Fetches the pinned file and returns it normalised. The one place the network is used. */
export async function fetchSnapshot(): Promise<Snapshot> {
  const data = await getJson(raw(SOURCE.path));
  const { ratings, aliases: inlineAliases } = SOURCE.normalise(data);
  const aliases = SOURCE.aliases ? ((await getJson(raw(SOURCE.aliases))) as Record<string, string>) : inlineAliases;
  const count = Object.keys(ratings).length;
  if (count < 1000) throw new Error(`MBFC snapshot: only ${count} ratings in ${SOURCE.path}; refusing to bundle it`);
  return {
    source: { repo: REPO, commit: COMMIT, path: SOURCE.path, url: raw(SOURCE.path) },
    snapshotDate: await commitDate(`commits/${COMMIT}`),
    dataUpdated: await commitDate(`commits?path=${encodeURIComponent(SOURCE.path)}&sha=${COMMIT}&per_page=1`),
    aliases,
    ratings,
  };
}

/** Writes the snapshot unless the one on disk already comes from the pinned file and commit. */
export async function ensureSnapshot({ force = false } = {}): Promise<void> {
  if (!force) {
    try {
      const current = JSON.parse(await readFile(OUTPUT, 'utf8')) as Snapshot;
      if (current.source?.commit === COMMIT && current.source?.path === SOURCE.path) return;
    } catch {
      // Missing or unreadable: take it.
    }
  }
  const snapshot = await fetchSnapshot();
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(snapshot)}\n`);
  console.log(
    `MBFC snapshot: ${Object.keys(snapshot.ratings).length} ratings from ${snapshot.source.path} at ${COMMIT.slice(0, 7)} ` +
      `(${snapshot.snapshotDate}; file last changed ${snapshot.dataUpdated})`,
  );
}

// ---- Normalising ----------------------------------------------------------

const BIASES: Record<string, BiasKey> = {
  left: 'left',
  leftcenter: 'left-center',
  'left-center': 'left-center',
  center: 'center',
  'right-center': 'right-center',
  right: 'right',
  'pro-science': 'pro-science',
  conspiracy: 'conspiracy',
  'conspiracy-pseudoscience': 'conspiracy',
  'fake-news': 'fake-news',
  satire: 'satire',
};

const REPORTING: Record<string, Reporting> = {
  'VERY HIGH': 'VERY HIGH',
  'VERY-HIGH': 'VERY HIGH',
  HIGH: 'HIGH',
  'MOSTLY FACTUAL': 'MOSTLY FACTUAL',
  'MOSTLY-FACTUAL': 'MOSTLY FACTUAL',
  MIXED: 'MIXED',
  LOW: 'LOW',
  'VERY LOW': 'VERY LOW',
  'VERY-LOW': 'VERY LOW',
  FAKE: 'FAKE',
};

function entry(domain: string, bias: unknown, reporting: unknown, page: unknown, name: unknown): [string, Entry] | null {
  const b = BIASES[String(bias)];
  if (!b || !domain) return null;
  const r = typeof reporting === 'string' ? (REPORTING[reporting.toUpperCase()] ?? null) : null;
  // A few links in the data aren't MBFC pages (http://, typos, other sites).
  const u = typeof page === 'string' && page.startsWith('https://mediabiasfactcheck.com/') ? page : null;
  return [domain.toLowerCase().replace(/^www\./, '').replace(/\/+$/, ''), { b, r, u, n: typeof name === 'string' ? name : domain }];
}

function fromCsources(data: unknown) {
  const ratings: Record<string, Entry> = {};
  for (const [domain, e] of Object.entries(data as Record<string, { b?: unknown; r?: unknown; u?: unknown; n?: unknown }>)) {
    const pair = entry(domain, e.b, e.r, e.u, e.n);
    if (pair) ratings[pair[0]] = pair[1];
  }
  return { ratings, aliases: {} as Record<string, string> };
}

function fromCombined(data: unknown) {
  const combined = data as {
    aliases?: Record<string, string>;
    sources: Array<{ domain: string; bias: unknown; reporting?: unknown; url?: unknown; name?: unknown }>;
  };
  const ratings: Record<string, Entry> = {};
  for (const s of combined.sources) {
    const pair = entry(s.domain, s.bias, s.reporting, s.url, s.name);
    if (pair) ratings[pair[0]] = pair[1];
  }
  return { ratings, aliases: combined.aliases ?? {} };
}

// ---- Network --------------------------------------------------------------

async function getJson(url: string): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'claimcatcher-build' };
  const token = process.env.GITHUB_TOKEN;
  if (token && url.startsWith('https://api.github.com/')) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`MBFC snapshot: ${url} answered ${response.status}`);
  return response.json();
}

async function commitDate(apiPath: string): Promise<string> {
  const reply = (await getJson(`https://api.github.com/repos/${REPO}/${apiPath}`)) as
    | { commit?: { committer?: { date?: string } } }
    | Array<{ commit?: { committer?: { date?: string } } }>;
  const date = (Array.isArray(reply) ? reply[0] : reply)?.commit?.committer?.date;
  if (!date) throw new Error(`MBFC snapshot: no commit date from ${apiPath}`);
  return date.slice(0, 10);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await ensureSnapshot({ force: process.argv.includes('--force') });
}
