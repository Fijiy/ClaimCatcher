// Runs the verdict gate: every case through the shipped verdict step
// (`judgeClaim`: the verdict prompt, retried once, then the consistency rule),
// once per run, each run on a fresh model. Local mode passes Gemini Nano
// (createNanoModel in an extension page, see local.ts); the cloud run passes
// the provider's model (createVenice, see cloud.ts).

import { judgeClaim } from '../../src/session/checks/pipeline';
import { ProviderError, type JsonModel } from '../../src/session/checks/provider';
import type { GateCase } from './eval-set';
import type { Judged } from './score';

export interface GateOptions {
  /** Runs over the whole set; two by default, so the repeat check can be measured. */
  runs?: number;
  /** Milliseconds, for timing each verdict. */
  now?: () => number;
  onVerdict?: (run: number, index: number, judged: Judged) => void;
}

/**
 * Resolves to each run's verdicts, in case order. A verdict the model still
 * fails after its retry ends Unverified (with the error), as its card would;
 * a rejected key, no credit or any other error rejects the whole gate.
 */
export async function runGate(
  cases: GateCase[],
  newModel: (run: number) => JsonModel | Promise<JsonModel>,
  options: GateOptions = {},
): Promise<Judged[][]> {
  const now = options.now ?? (() => performance.now());
  const runs: Judged[][] = [];
  for (let run = 0; run < (options.runs ?? 2); run++) {
    const model = await newModel(run);
    const verdicts: Judged[] = [];
    for (const [index, c] of cases.entries()) {
      const start = now();
      let judged: Judged;
      try {
        const said = await judgeClaim(model, c.input);
        judged = { caseId: c.id, label: said.label, ms: now() - start, conclusion: said.conclusion };
      } catch (error) {
        // Only the model failing ends a claim Unverified. A rejected key, no
        // credit, or the harness itself breaking stops the gate.
        if (!(error instanceof ProviderError) || error.kind !== 'failed') throw error;
        judged = { caseId: c.id, label: 'Unverified', ms: now() - start, error: error.message };
      }
      verdicts.push(judged);
      options.onVerdict?.(run, index, judged);
    }
    runs.push(verdicts);
  }
  return runs;
}
