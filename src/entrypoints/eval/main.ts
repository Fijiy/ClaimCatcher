// The quality gate's page (ticket #40). Built only by `wxt build --mode eval`
// (see the `entrypoints:resolved` hook in wxt.config.ts), never shipped.
//
// It holds Gemini Nano for `pnpm eval:local`: the shipped adapter
// (`createNanoModel`) on Chrome's `LanguageModel`, in an extension page, where
// Chrome accepts the temperature and topK local mode uses (as in the offscreen
// document). Everything else of the verdict step (prompt, schema, parsing, the
// retry and the consistency rule) runs in the driver, from the same shipped
// code, so only the model sits here.
//
// It also holds the bundled on-device models for `pnpm eval:on-device`: the
// shipped model worker, as the offscreen document starts it. The driver runs
// the shipped clients (transcriber, claim filter, voice clustering) in Node
// and sends each model task here.
//
// `?fake` swaps in the fake `LanguageModel` the session tests use, so the
// harness can be run end to end on a machine without Gemini Nano.

import { checkLocalModel, chromeLanguageModel, downloadLocalModel } from '../../local-model';
import { startModelWorker, type ModelClient } from '../../models/client';
import { createNanoModel, type LanguageModelFactory } from '../../session/checks/nano';
import { ProviderError, type JsonModel } from '../../session/checks/provider';
import { createFakeLanguageModel } from '../../session/testing/fake-language-model';
import type { EvalBridge, ModelReply } from './bridge';
import { fromWire, toWire, type Wire } from './wire';

const fake = new URLSearchParams(location.search).has('fake');
const factory: LanguageModelFactory | undefined = fake ? fakeNano() : chromeLanguageModel();
const models: JsonModel[] = [];
let download: ReturnType<EvalBridge['download']> = null;
let worker: ModelClient | undefined;
const modelWorker = () => (worker ??= startModelWorker());

const statusLine = document.getElementById('status')!;
const button = document.getElementById('download') as HTMLButtonElement;

// Chrome downloads Gemini Nano only for a page the viewer has clicked: the
// driver clicks this (a trusted click through the DevTools protocol).
button.addEventListener('click', () => {
  download = 0;
  button.disabled = true;
  downloadLocalModel((fraction) => {
    download = fraction;
    statusLine.textContent = `Downloading Gemini Nano: ${Math.round(fraction * 100)}%`;
  }).then(
    () => (download = 'done'),
    (error: unknown) => (download = { error: String(error) }),
  );
});

window.claimcatcherEval = {
  async localModel() {
    const state = fake ? ({ state: 'available' } as const) : await checkLocalModel();
    button.hidden = !(state.state === 'downloadable' || state.state === 'downloading');
    return state;
  },
  download: () => download,
  newModel() {
    if (!factory) throw new Error("Chrome's LanguageModel isn't available in this browser");
    models.push(createNanoModel(factory));
    return models.length - 1;
  },
  async generate(model, request) {
    try {
      return { ok: true, value: await models[model]!.generate(request) };
    } catch (error) {
      if (error instanceof ProviderError) return { ok: false, kind: error.kind, source: error.source, message: error.message };
      return { ok: false, kind: 'failed', source: 'on-device', message: String(error) };
    }
  },
  async runModel(task, input) {
    let reply: ModelReply;
    try {
      const output = await modelWorker().run(task, fromWire(JSON.parse(input) as Wire) as never);
      reply = { ok: true, output: toWire(output) };
    } catch (error) {
      reply = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    return JSON.stringify(reply);
  },
  modelRuntime: () => modelWorker().runtime(),
  status(text) {
    statusLine.textContent = text;
  },
};
statusLine.textContent = fake ? 'Ready (fake Gemini Nano).' : 'Ready.';

/** A stand-in for Gemini Nano that calls every claim Misleading: it proves the harness, not a model. */
function fakeNano(): LanguageModelFactory {
  const nano = createFakeLanguageModel();
  nano.onVerdict(() => ({
    literal: 'The claim states a figure.',
    implied: 'The figure tells the whole story.',
    evidence: 'The sources give the figure.',
    conclusion: 'The sources confirm the figure but leave out how it compares.',
    label: 'Misleading',
    missing: 'How the figure compares.',
    sources: [],
  }));
  return nano.factory;
}
