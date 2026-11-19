import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadVerdictCases } from './eval-set';

// These run on the real evaluation set in eval/, so they also check its data.

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../eval/${path}`, import.meta.url), 'utf8')) as unknown;

interface Clip {
  id: string;
  date: string;
  claims: Array<{ text: string; mapped_label: string | null; mapping_basis: string | null }>;
}

describe('the verdict gate cases', () => {
  const cases = loadVerdictCases();
  const clips = read('clips.json') as Clip[];

  it("are the evaluation set's 29 rated claims, as of the day each was said", () => {
    const rated = clips.flatMap((clip) =>
      clip.claims.flatMap((claim, i) => (claim.mapped_label ? [{ id: `${clip.id}#${i}`, date: clip.date, basis: claim.mapping_basis }] : [])),
    );
    expect(rated).toHaveLength(29);
    expect(cases.map((c) => ({ id: c.id, date: c.date, basis: c.basis })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [...rated].sort((a, b) => a.id.localeCompare(b.id)),
    );
    for (const c of cases) expect(c.input.judgedAsOf).toBe(c.date);
    // Each claim's speaker is named, as on a card whose speaker the page or viewer settled.
    expect(cases.find((c) => c.id === 'cnn-2024-trump-greatest-economy#0')!.input.speaker).toBe('Donald Trump');
    expect(cases.filter((c) => c.basis === 'firm')).toHaveLength(12);
    expect(cases.filter((c) => c.basis === 'judgment')).toHaveLength(17);
  });

  it('are scored against the audited key', () => {
    const byId = new Map(cases.map((c) => [c.id, c]));
    // The audit's one correction: PolitiFact's Mostly False on Vance's CBP One claim maps to False.
    expect(byId.get('cbs-2024-vance-cbp-one-mic-cut#1')).toMatchObject({ truth: 'False', accept: ['False'] });
    // A claim the audit found disputed accepts both labels.
    expect(byId.get('biden-sotu-2024-economy#7')).toMatchObject({ truth: 'True', accept: ['True', 'Misleading'] });
    // Every other claim keeps the label clips.json maps it to.
    const mapped = new Map(clips.flatMap((clip) => clip.claims.map((claim, i): [string, string | null] => [`${clip.id}#${i}`, claim.mapped_label])));
    const unchanged = cases.filter((c) => c.id !== 'cbs-2024-vance-cbp-one-mic-cut#1');
    for (const c of unchanged) expect(c.truth, c.id).toBe(mapped.get(c.id));
    expect(cases.map((c) => c.truth).filter((t) => t === 'True')).toHaveLength(8);
  });

  it('give the verdict step at most 5 sources of at most 400 characters, none published after the claim', () => {
    for (const c of cases) {
      expect(c.input.evidence.length, c.id).toBeLessThanOrEqual(5);
      expect(c.input.evidence.map((e) => e.n)).toEqual(c.input.evidence.map((_, i) => i + 1));
      for (const e of c.input.evidence) {
        expect(e.snippet.length).toBeLessThanOrEqual(400);
        if (e.published) expect(e.published.slice(0, 10) <= c.date, `${c.id} ${e.url}`).toBe(true);
      }
    }
    // As eval/verdicts/evidence/README.md says: once later results are dropped, one claim has no sources left.
    expect(cases.filter((c) => c.input.evidence.length === 0).map((c) => c.id)).toEqual(['us-vance-peachtree-city-2025-08-21-biggest-tax-cut#1']);
  });

  it("never give the verdict step a professional rating of the claim itself", () => {
    const answers = read('verdicts/rated-claims.json') as Array<{ case_id: string; answer_urls: string[] }>;
    const strip = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
    for (const { case_id, answer_urls } of answers) {
      const given = cases.find((c) => c.id === case_id)!.input.evidence.map((e) => strip(e.url));
      for (const url of answer_urls) expect(given, case_id).not.toContain(strip(url));
    }
  });
});
