// `pnpm eval:on-device`: the quality gates for the bundled on-device models,
// on the clip audio `pnpm eval:fetch` put in eval/media/ (never committed).
//
//   speech-to-text    word error rate ≤ 10% over the evaluation clips
//   claim filter      ≥ 90% of rated claims caught, ≤ 40% of sentences passed
//   voice separation  ≥ 90% of speech on the right voice, in each of four
//                     broadcasts and in one whole debate (about 95 minutes)
//
// Builds the extension with the gate's page (`wxt build --mode eval`), opens
// it in Chrome for Testing and starts the shipped model worker there: the same
// models, on the same WASM runtime, as the offscreen document. The shipped
// clients run here in Node, unchanged: the transcriber (pieces cut at pauses),
// `createSpeechToText`, `createClaimFilter` (its threshold decides), and
// `createVoiceSeparation` (the voice clustering); each model call goes to the
// page. Prints each bar with PASS or FAIL, and writes the run, with the
// machine it ran on, to eval/results/.
//
//   pnpm eval:on-device                       every gate
//   pnpm eval:on-device --only stt,filter     some (stt, filter, voices)
//   --no-full    the voice gate without the whole debate (it takes a few minutes)
//   --no-build   reuse .output/chrome-mv3-eval/;  HEADED=1 to watch
//
// Exit code: 0 if every gate run passes, 1 if any fails, 2 if it can't run
// (audio missing: run `pnpm eval:fetch`). See docs/quality-gate.md.

import { chromium, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cpus, release, totalmem, version } from 'node:os';
import { join } from 'node:path';
import { build } from 'wxt';
import { MERGE_ABOVE, NEW_VOICE_BELOW, NEW_VOICE_MIN_S } from '../../src/audio/voice-clusters';
import type { ModelReply } from '../../src/entrypoints/eval/bridge';
import { fromWire, toWire } from '../../src/entrypoints/eval/wire';
import { createClaimFilter, PASS_THRESHOLD } from '../../src/models/claim-filter';
import type { ModelClient } from '../../src/models/client';
import type { ModelRuntime, TaskInput, TaskName, TaskOutput } from '../../src/models/protocol';
import { createSpeechToText } from '../../src/models/speech-to-text';
import { createVoiceSeparation, type SeparatedVoices } from '../../src/models/voice-separation';
import { openGatePage } from './browser';
import { flag, option, ROOT, writeResults } from './cli';
import { formatFilterReport, loadFilterSentences, scoreFilter, sweepFilter } from './filter';
import { clipAudio, fullAudio, MEDIA, readWav, wavInfo } from './media';
import { playThroughTranscriber, type AudioSource } from './play';
import { finalVoices, formatVoiceReport, loadVoiceSessions, scoreVoiceGate, scoreVoices, type ScoredSession } from './voices';
import { formatWerReport, scoreWer, type HeardClip } from './wer';

type Models = Pick<ModelClient, 'run'>;
type GateId = 'stt' | 'filter' | 'voices';
const GATES: GateId[] = ['stt', 'filter', 'voices'];

class CantRun extends Error {}

interface ClipFile {
  id: string;
  video: { start_s: number; end_s: number };
  reference_transcript: { text: string };
}

const clips = JSON.parse(readFileSync(join(ROOT, 'eval', 'clips.json'), 'utf8')) as ClipFile[];

function chosenGates(): GateId[] {
  const only = option('only')?.split(',');
  const unknown = only?.filter((g) => !GATES.includes(g as GateId));
  if (unknown?.length) throw new CantRun(`--only takes ${GATES.join(', ')}; not ${unknown.join(', ')}`);
  return only ? (only as GateId[]) : GATES;
}

/** The audio files each chosen gate needs; throws CantRun naming any that are missing. */
function checkAudio(gates: GateId[], full: boolean) {
  const needed: string[] = [];
  if (gates.includes('stt')) needed.push(...clips.map((c) => clipAudio(c.id)));
  if (gates.includes('voices')) {
    const { sessions, fullDebate } = loadVoiceSessions();
    needed.push(...sessions.flatMap((s) => s.clips.map((c) => clipAudio(c.clip))));
    if (full) needed.push(fullAudio(fullDebate.id));
  }
  const missing = [...new Set(needed)].filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new CantRun(`${missing.length} audio file(s) missing, e.g. ${missing[0]!.slice(ROOT.length)}. Run \`pnpm eval:fetch\` first.`);
  }
}

/** The page's model worker, as a `ModelClient` for the shipped clients. */
function pageModels(page: Page): Models {
  return {
    async run<T extends TaskName>(task: T, input: TaskInput<T>): Promise<TaskOutput<T>> {
      const json = await page.evaluate(([t, i]) => window.claimcatcherEval!.runModel(t, i), [task, JSON.stringify(toWire(input))] as const);
      const reply = JSON.parse(json) as ModelReply;
      if (!reply.ok) throw new Error(`${task} failed in the model worker: ${reply.message}`);
      return fromWire(reply.output) as TaskOutput<T>;
    },
  };
}

function source(path: string, start: number): AudioSource {
  return { start, sampleRate: wavInfo(path).sampleRate, audio: readWav(path) };
}

async function speechToTextGate(models: Models) {
  const stt = createSpeechToText(models);
  await stt.warm();
  const heard: HeardClip[] = [];
  for (const clip of clips) {
    const played = await playThroughTranscriber([source(clipAudio(clip.id), clip.video.start_s)], { transcribe: (s) => stt.transcribe(s) });
    const seconds = clip.video.end_s - clip.video.start_s;
    heard.push({ clip: clip.id, reference: clip.reference_transcript.text, heard: played.segments.map((s) => s.text).join(' '), seconds, ms: played.transcribeMs });
    console.log(`  ${clip.id}: ${played.segments.length} pieces, ${(played.transcribeMs / 1000).toFixed(1)} s`);
  }
  const score = scoreWer(heard);
  console.log(`\n${formatWerReport('Moonshine base (8-bit, WASM) through the shipped transcriber', score)}\n`);
  return { score, heard: heard.map(({ clip, heard: text }) => ({ clip, heard: text })) };
}

async function filterGate(models: Models) {
  const filter = createClaimFilter(models);
  await filter.warm();
  const sentences = loadFilterSentences();
  const passed: boolean[] = [];
  for (const s of sentences) passed.push(await filter.passes(s.text));
  const { scores } = await models.run('claim-filter', { sentences: sentences.map((s) => s.text) });
  const score = scoreFilter(sentences, passed);
  const sweep = sweepFilter(sentences, scores, [0.3, 0.4, 0.5, 0.6, 0.7]);
  console.log(`\n${formatFilterReport(`claimbuster-detector (8-bit, WASM), shipped threshold ${PASS_THRESHOLD}`, score, sweep)}\n`);
  return { threshold: PASS_THRESHOLD, score, sweep: sweep.map(({ threshold, score: s }) => ({ threshold, rated: s.rated.rate, all: s.all.rate, passed: s.passed.rate })), scores };
}

/** Logs how far a long source has played, every 10 minutes of audio. */
function withProgress(audio: Iterable<Float32Array>, sampleRate: number, label: string): Iterable<Float32Array> {
  return (function* () {
    let samples = 0;
    let next = 600;
    const started = performance.now();
    for (const frame of audio) {
      samples += frame.length;
      if (samples / sampleRate >= next) {
        console.log(`  ${label}: ${next / 60} min played (${((performance.now() - started) / 1000).toFixed(0)} s)`);
        next += 600;
      }
      yield frame;
    }
  })();
}

async function voiceGate(models: Models, full: boolean) {
  const { sessions, fullDebate } = loadVoiceSessions();
  // Warm both models before timing anything.
  await createVoiceSeparation(models, () => 'warm').warm();

  const separateAll = async (sources: AudioSource[]) => {
    let count = 0;
    // One set of voices per page, as the offscreen document keeps one per tab.
    const separation = createVoiceSeparation(models, () => `voice-${++count}`);
    const results: SeparatedVoices[] = [];
    const played = await playThroughTranscriber(sources, {
      // The voice gate measures voice separation only; speech-to-text has its own gate.
      transcribe: async () => '',
      separate: async (samples, time) => {
        const separated = await separation.separate(samples, time);
        results.push(separated);
        return separated.turns;
      },
    });
    return { voiced: finalVoices(results), ms: played.separateMs };
  };

  const scored: Array<ScoredSession & { ms: number }> = [];
  const voiced: Record<string, unknown> = {};
  for (const session of sessions) {
    const sources = session.clips.map((c) => source(clipAudio(c.clip), clips.find((x) => x.id === c.clip)!.video.start_s));
    const minutes = session.clips.reduce((n, c) => n + wavInfo(clipAudio(c.clip)).length / wavInfo(clipAudio(c.clip)).sampleRate, 0) / 60;
    const run = await separateAll(sources);
    scored.push({ id: session.id, score: scoreVoices(session.clips.flatMap((c) => c.turns), run.voiced), minutes, ms: run.ms });
    voiced[session.id] = run.voiced;
    console.log(`  ${session.id}: ${minutes.toFixed(1)} min, ${(run.ms / 1000).toFixed(1)} s`);
  }
  if (full) {
    const path = fullAudio(fullDebate.id);
    const info = wavInfo(path);
    const minutes = info.length / info.sampleRate / 60;
    console.log(`  ${fullDebate.id}: playing the whole debate (${minutes.toFixed(0)} min)…`);
    const run = await separateAll([{ start: fullDebate.start_s, sampleRate: info.sampleRate, audio: withProgress(readWav(path), info.sampleRate, fullDebate.id) }]);
    scored.push({ id: fullDebate.id, score: scoreVoices(fullDebate.turns, run.voiced), full: true, minutes, speakers: fullDebate.speakers.length, ms: run.ms });
    voiced[fullDebate.id] = run.voiced;
    console.log(`  ${fullDebate.id}: ${(run.ms / 1000).toFixed(0)} s`);
  }
  const gate = scoreVoiceGate(scored);
  console.log(
    `\n${formatVoiceReport(`pyannote segmentation 3.0 + WeSpeaker ResNet34 (8-bit, WASM), clustering new < ${NEW_VOICE_BELOW} (≥ ${NEW_VOICE_MIN_S} s), merge > ${MERGE_ABOVE}`, gate)}\n`,
  );
  const minutes = scored.reduce((n, s) => n + (s.minutes ?? 0), 0);
  const ms = scored.reduce((n, s) => n + s.ms, 0);
  console.log(`Voice separation time: ${((ms / 1000 / (minutes * 60)) * 100).toFixed(1)}% of the audio's length\n`);
  return { clustering: { newVoiceBelow: NEW_VOICE_BELOW, newVoiceMinS: NEW_VOICE_MIN_S, mergeAbove: MERGE_ABOVE }, gate, voiced };
}

/** "macOS 26.5.1" where it can tell, else the platform. */
function osName(): string {
  if (process.platform !== 'darwin') return process.platform;
  const sw = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' });
  return sw.status === 0 ? `macOS ${sw.stdout.trim()}` : 'macOS';
}

function machine(runtime: ModelRuntime, browser: string, userAgent: string): Record<string, string> {
  const cpu = cpus();
  return {
    cpu: `${cpu[0]?.model ?? 'unknown'} (${cpu.length} cores)`,
    memory: `${Math.round(totalmem() / 2 ** 30)} GB`,
    os: `${osName()}, ${process.arch} (${version()} ${release()})`,
    node: process.version,
    browser: `Chrome for Testing ${browser}`,
    userAgent,
    modelRuntime: `${runtime.threads} WASM threads, cross-origin isolated: ${runtime.crossOriginIsolated}, WebGPU adapter: ${runtime.webgpu}`,
    audio: MEDIA.startsWith(ROOT) ? `${MEDIA.slice(ROOT.length)} (pnpm eval:fetch)` : MEDIA,
  };
}

async function main(): Promise<number> {
  const gates = chosenGates();
  const full = !flag('no-full');
  checkAudio(gates, full);
  if (!flag('no-build')) {
    console.log('Building the extension with the gate page (wxt build --mode eval)…');
    await build({ mode: 'eval' });
  }
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: process.env.HEADED !== '1',
    args: ['--enable-unsafe-extension-debugging'],
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  try {
    const page = await openGatePage(context);
    const runtime = await page.evaluate(() => window.claimcatcherEval!.modelRuntime());
    const environment = machine(runtime, context.browser()?.version() ?? 'unknown', await page.evaluate(() => navigator.userAgent));
    console.log(`\nOn ${environment.cpu}, ${environment.memory}; ${environment.modelRuntime}\n`);
    const models = pageModels(page);
    const started = new Date().toISOString();
    const results: Record<string, unknown> = {};
    const passes: Record<string, boolean> = {};
    if (gates.includes('stt')) {
      console.log('Speech-to-text gate…');
      const run = await speechToTextGate(models);
      [results.speechToText, passes.speechToText] = [run, run.score.pass];
    }
    if (gates.includes('filter')) {
      console.log('Claim filter gate…');
      const run = await filterGate(models);
      [results.claimFilter, passes.claimFilter] = [run, run.score.pass];
    }
    if (gates.includes('voices')) {
      console.log('Voice separation gate…');
      const run = await voiceGate(models, full);
      [results.voiceSeparation, passes.voiceSeparation] = [run, run.gate.pass];
    }
    console.log(Object.entries(passes).map(([gate, pass]) => `${gate}: ${pass ? 'PASS' : 'FAIL'}`).join(' · '));
    const path = writeResults('on-device', started, { gate: 'on-device', started, environment, passes, ...results });
    console.log(`Recorded in ${path.slice(ROOT.length)}`);
    return Object.values(passes).every(Boolean) ? 0 : 1;
  } finally {
    await context.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`\n${error instanceof CantRun ? "The gate can't run: " : ''}${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  },
);
