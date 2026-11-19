// Helpers shared by the gates' commands (local.ts, cloud.ts, on-device.ts).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GateCase } from './eval-set';
import type { GateScore, Judged } from './score';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);

export const flag = (name: string) => args.includes(`--${name}`);

export function option(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export function runsOption(): number {
  const runs = Number(option('runs') ?? 2);
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs takes a whole number of runs, at least 1');
  return runs;
}

/** One line per verdict while the gate runs. */
export function progress(cases: GateCase[], runs: number, prefix = '') {
  return (run: number, index: number, judged: Judged) => {
    const where = `${prefix}run ${run + 1}/${runs}, claim ${String(index + 1).padStart(2)}/${cases.length}`;
    const said = judged.error ? `Unverified (failed: ${judged.error})` : judged.label;
    console.log(`  ${where}  ${(judged.ms / 1000).toFixed(1).padStart(5)} s  ${said}  [${cases[index]!.id}]`);
  };
}

/** What a run of the gate records: never a key. */
export interface GateRecord {
  gate: 'verdicts';
  variant: 'local' | 'cloud';
  /** When the run started, ISO. */
  started: string;
  environment: Record<string, string>;
  models: Array<{ model: string; skipped?: string; costUsd?: number | null; score?: Omit<GateScore, 'runs'> & { runs: unknown }; runs: Judged[][] }>;
  picked?: string | null;
}

/** Writes the run to eval/results/ (commit the run a pick rests on) and returns the path. */
export function writeRecord(record: GateRecord): string {
  return writeResults(`verdicts-${record.variant}`, record.started, record);
}

/** Writes a gate's run to eval/results/<name>-<started>.json and returns the path. */
export function writeResults(name: string, started: string, record: unknown): string {
  const dir = join(ROOT, 'eval', 'results');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}-${started.replace(/[:.]/g, '-').slice(0, 19)}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}
