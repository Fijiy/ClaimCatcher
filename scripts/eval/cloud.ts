// `pnpm eval:cloud`: the cloud run of the verdict gate, which picks cloud
// mode's model. Same cases, evidence and bar as `pnpm eval:local`; the shipped
// provider adapter (createVenice) and verdict step, with the entrant's key.
//
//   VENICE_API_KEY=… pnpm eval:cloud            every candidate Venice lists today
//   pnpm eval:cloud --key-file ~/.config/claimcatcher/venice-key
//   pnpm eval:cloud --models a,b                 only these models
//   pnpm eval:cloud --fake                       prove the harness without a key (fake Venice)
//   --runs N
//
// The key is read from VENICE_API_KEY, or from the file named by --key-file
// or VENICE_API_KEY_FILE. It is sent only to Venice, and never printed or
// written down. Exit code: 0 if a model clears the bar (or --fake), 1 if none
// does, 2 if the gate can't run. See docs/quality-gate.md.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { PROVISIONAL_MODEL } from '../../src/session/checks/venice';
import { createFakeVenice } from '../../src/session/testing/fake-venice';
import { flag, option, progress, ROOT, runsOption, writeRecord } from './cli';
import { listCandidates, pickModel, runCloudGate, type ModelOutcome } from './cloud-gate';
import { loadVerdictCases } from './eval-set';
import { formatReport } from './score';

const fake = flag('fake');

function readKey(): string {
  const file = option('key-file') ?? process.env.VENICE_API_KEY_FILE;
  const raw = file ? readFileSync(file.replace(/^~(?=\/)/, homedir()), 'utf8') : process.env.VENICE_API_KEY;
  // As the key setup does: pasted keys pick up quotes, whitespace or "Bearer ".
  const key = (raw ?? '').trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '');
  if (!key) throw new Error('No Venice API key: set VENICE_API_KEY, or pass --key-file <path> (keep the file outside the repo).');
  return key;
}

/** A fake Venice for --fake: lists two candidates, and calls every claim Misleading. */
function fakeVenice(): typeof fetch {
  const venice = createFakeVenice();
  venice.onVerdict(() => ({
    literal: 'The claim states a figure.',
    implied: 'The figure tells the whole story.',
    evidence: 'The sources give the figure.',
    conclusion: 'The sources confirm the figure but leave out how it compares.',
    label: 'Misleading',
    missing: 'How the figure compares.',
    sources: [],
  }));
  const models = ['fake-model-a', 'fake-model-b'].map((id) => ({
    id,
    model_spec: { privacy: 'private', offline: false, capabilities: { supportsReasoning: false, supportsResponseSchema: true } },
  }));
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('/models?') ? Response.json({ data: models }) : venice.fetch(input, init)) as typeof fetch;
}

async function main(): Promise<number> {
  const runs = runsOption();
  const cases = loadVerdictCases();
  const fetchFn = fake ? fakeVenice() : fetch;
  const apiKey = fake ? 'fake-key' : readKey();
  const models = option('models')?.split(',').map((m) => m.trim()).filter(Boolean) ?? (await listCandidates(fetchFn));
  if (models.length === 0) throw new Error('Venice lists no private, non-reasoning model with JSON-schema output today; pass --models to choose some.');
  console.log(`Candidates (${models.length}): ${models.join(', ')}`);
  console.log(`Running ${cases.length} claims × ${runs} runs on each${fake ? ' [FAKE Venice]' : ''}…`);

  const started = new Date().toISOString();
  const outcomes = await runCloudGate(cases, {
    fetch: fetchFn,
    apiKey,
    models,
    runs,
    onVerdict: (model, run, index, judged) => progress(cases, runs, `${model}: `)(run, index, judged),
  });

  for (const o of outcomes) {
    if (o.skipped) console.log(`\n${o.model}: skipped, this key can't use it (${o.skipped})`);
    else console.log(`\n${formatReport(`${o.model} on Venice${costLine(o)}`, cases, o.score!)}`);
  }
  const picked = pickModel(outcomes);
  console.log('\nSummary:');
  for (const o of outcomes) console.log(`  ${o.score?.pass ? 'PASS' : o.skipped ? 'SKIP' : 'FAIL'}  ${o.model}`);
  if (fake) {
    console.log('\nFAKE Venice: this proves the harness only; the scores mean nothing.');
    return 0;
  }
  const path = writeRecord({
    gate: 'verdicts',
    variant: 'cloud',
    started,
    environment: { provider: 'Venice', platform: `${process.platform} ${process.arch}`, node: process.version },
    models: outcomes.map((o) => ({
      model: o.model,
      ...(o.skipped ? { skipped: o.skipped } : {}),
      costUsd: o.costUsd,
      ...(o.score ? { score: o.score } : {}),
      runs: o.runs,
    })),
    picked: picked?.model ?? null,
  });
  console.log(`\nRecorded in ${path.slice(ROOT.length)}`);
  if (!picked) {
    console.log('No candidate clears the bar: keep the current model and say so in docs/quality-gate.md.');
    return 1;
  }
  console.log(`\nPick: ${picked.model}${picked.model === PROVISIONAL_MODEL ? ' (the model cloud mode already uses)' : ''}`);
  if (picked.model !== PROVISIONAL_MODEL) console.log(`Set it in src/session/checks/venice.ts (now '${PROVISIONAL_MODEL}').`);
  console.log('Record the pick and this run in docs/quality-gate.md, and commit the results file.');
  return 0;
}

function costLine(o: ModelOutcome): string {
  if (o.costUsd === null) return '';
  const verdicts = o.runs.flat().length;
  return ` ($${o.costUsd.toFixed(4)} for ${verdicts} verdicts, $${(o.costUsd / Math.max(1, verdicts)).toFixed(5)} each)`;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`\nThe gate can't run: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  },
);
