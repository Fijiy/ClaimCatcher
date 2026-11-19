// Local mode's LLM: Chrome's built-in Gemini Nano through the Prompt API
// (`LanguageModel`, see cac-notes external-prompt-api.md), behind the same
// `JsonModel` seam as the provider's LLM. Search stays with the provider.
//
// - Temperature 0.1 and topK 1 (0 crashes or hangs Nano; Chrome accepts both
//   only in extension pages, which the offscreen document is).
// - A fresh session for every prompt, never a follow-up prompt: each prompt
//   runs in a new clone of a session primed with the step's system prompt,
//   and the clone is destroyed after its one answer. Follow-ups made Nano
//   crash in bursts in the prototype, and Chrome turns Nano off after 3.
// - One prompt at a time: two prompts sharing Nano slow it down and crash it.
// - A crash (`kErrorUnknown`), a hang (no answer in time) or a broken reply
//   throws away the primed session, so the next prompt starts from a rebuilt
//   one, and fails as `failed`: the pipeline retries once, then the card ends
//   as Unverified. Nothing here ever switches to another model or mode.
//
// The factory is injected (the offscreen document passes `LanguageModel`;
// tests pass testing/fake-language-model.ts), so this file never touches the
// browser. Callable on its own: `judge(createNanoModel(LanguageModel), input)`
// is the verdict step on Nano, which the quality gate (#40) runs.

import type { Clock } from '../types';
import { ProviderError, type JsonModel, type JsonRequest, type JsonSchema, type UsageListener } from './provider';

/** What `LanguageModel.availability()` reports. */
export type NanoAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

/**
 * The options every availability check, download and session uses. Chrome's
 * docs: pass the same options to `availability()` as to `create()`.
 */
export const NANO_OPTIONS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
  temperature: 0.1,
  topK: 1,
} as const;

export type NanoOptions = typeof NANO_OPTIONS;

export interface NanoCreateOptions extends NanoOptions {
  initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  monitor?: (monitor: EventTarget) => void;
  signal?: AbortSignal;
}

/** The part of a Prompt API session ClaimCatcher uses. */
export interface NanoSession {
  prompt(input: string, options: { responseConstraint?: JsonSchema; signal?: AbortSignal }): Promise<string>;
  clone(options?: { signal?: AbortSignal }): Promise<NanoSession>;
  destroy(): void;
}

/** The part of `LanguageModel` (the Prompt API's static side) ClaimCatcher uses. */
export interface LanguageModelFactory {
  availability(options: NanoOptions): Promise<NanoAvailability>;
  create(options: NanoCreateOptions): Promise<NanoSession>;
}

/**
 * How long one prompt may take before it counts as hung. Nano took 8.5 s
 * (median) and 10.6 s (p90) per verdict in the prototype, whose harness
 * allowed 60 s; slower devices and long verdict prompts need the headroom.
 */
export const NANO_TIMEOUT_MS = 60_000;

/**
 * How long building a primed session may take. The first one after the
 * download (or after Chrome restarts) loads the model, which can take far
 * longer than a prompt, so it isn't counted against `NANO_TIMEOUT_MS`.
 */
export const NANO_LOAD_TIMEOUT_MS = 180_000;

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface NanoModelOptions {
  /** Times the hang timeout. Defaults to the real clock. */
  clock?: Clock;
  timeoutMs?: number;
  loadTimeoutMs?: number;
  /** Told of every prompt Nano answered: its tokens (estimated) and how long it took. */
  onUsage?: UsageListener;
}

/**
 * About how many tokens a text is. Nano doesn't say what a prompt used, and
 * asking (`measureContextUsage`) would be one more call into a model that
 * crashes; English runs at about 4 characters a token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * How Nano is held to the reply's shape: always by a JSON schema (the spec's
 * "JSON-schema constrained"), never by the prompt alone. Its JSON Schema
 * subset isn't documented, so if Chrome refuses the schema
 * (`NotSupportedError`) the model steps down once, for the rest of the
 * session, to the schema without `enum`/`additionalProperties`. If Chrome
 * refuses that too, the prompt fails, and the check ends Unverified as one
 * that couldn't be checked. The steps' parsers check every reply either way.
 */
type ConstraintLevel = 'full' | 'loose';

export function createNanoModel(factory: LanguageModelFactory, options: NanoModelOptions = {}): JsonModel {
  const clock = options.clock ?? realClock;
  const timeoutMs = options.timeoutMs ?? NANO_TIMEOUT_MS;
  const loadTimeoutMs = options.loadTimeoutMs ?? NANO_LOAD_TIMEOUT_MS;
  const onUsage = options.onUsage ?? (() => {});
  let level: ConstraintLevel = 'full';
  /** One primed session per system prompt (claim breakdown, verdict), cloned for each prompt. */
  const primed = new Map<string, Promise<NanoSession>>();
  let queue: Promise<unknown> = Promise.resolve();

  function primedFor(system: string): Promise<NanoSession> {
    let session = primed.get(system);
    if (!session) {
      session = factory.create({ ...NANO_OPTIONS, initialPrompts: [{ role: 'system', content: system }] });
      primed.set(system, session);
    }
    return session;
  }

  /** Throws the primed session away, so the next prompt rebuilds it (the model process may have restarted). */
  function rebuild(system: string) {
    const session = primed.get(system);
    primed.delete(system);
    void session?.then((s) => s.destroy()).catch(() => {});
  }

  /** Rejects with `message` once `signal` aborts. */
  const aborted = (signal: AbortSignal, message: string) =>
    new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error(message))));

  /** The primed session for `system`, given up on (and dropped) if loading the model takes too long. */
  async function loaded(system: string): Promise<NanoSession> {
    const controller = new AbortController();
    const timer = clock.setTimeout(() => controller.abort(), loadTimeoutMs);
    try {
      return await Promise.race([primedFor(system), aborted(controller.signal, `the model did not load within ${loadTimeoutMs / 1000} s`)]);
    } finally {
      clock.clearTimeout(timer);
    }
  }

  async function promptOnce(base: NanoSession, user: string, schema: JsonSchema): Promise<string> {
    const controller = new AbortController();
    const timer = clock.setTimeout(() => controller.abort(), timeoutMs);
    let session: NanoSession | undefined;
    try {
      return await Promise.race([
        aborted(controller.signal, `no answer within ${timeoutMs / 1000} s`),
        (async () => {
          session = await base.clone({ signal: controller.signal });
          if (controller.signal.aborted) session.destroy();
          return session.prompt(user, { responseConstraint: forNano(schema, level), signal: controller.signal });
        })(),
      ]);
    } finally {
      clock.clearTimeout(timer);
      session?.destroy();
    }
  }

  async function run({ system, user, schema }: JsonRequest): Promise<unknown> {
    try {
      const base = await loaded(system);
      for (;;) {
        try {
          const began = clock.now();
          const raw = await promptOnce(base, user, schema);
          // Answered, so the device did the work, whatever the reply holds.
          onUsage({
            kind: 'llm',
            onDevice: true,
            tokensIn: estimateTokens(user),
            tokensOut: estimateTokens(raw),
            seconds: (clock.now() - began) / 1000,
            costUsd: null,
          });
          return fromNano(schema, parseJson(raw));
        } catch (error) {
          if (level === 'loose' || !refusesSchema(error)) throw error;
          level = 'loose';
          console.warn('[ClaimCatcher] Gemini Nano refused the response schema; now using a simpler schema', error);
        }
      }
    } catch (error) {
      console.warn('[ClaimCatcher] Gemini Nano failed', error);
      rebuild(system);
      throw new ProviderError('failed', `Gemini Nano: ${describe(error)}`, 'on-device');
    }
  }

  return {
    // Local mode: prompts may carry what stays on the device (the description).
    onDevice: true,
    generate(request) {
      const next = queue.then(() => run(request));
      queue = next.catch(() => {});
      return next;
    },
  };
}

/** Chrome refusing the response constraint itself (not a failed answer). */
function refusesSchema(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return (name === 'NotSupportedError' || name === 'TypeError') && /constraint|schema/i.test(message);
}

/** The reply's JSON. Nano may still wrap it in a code fence or a sentence. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw error;
    return JSON.parse(raw.slice(start, end + 1)) as unknown;
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.name && error.name !== 'Error' ? `${error.name}: ${error.message}` : error.message;
  return String(error);
}

// The provider's schemas allow `null` through a type list (`["string",
// "null"]`). Nano's supported JSON Schema subset isn't documented and the
// prototype only ran plain types, so Nano gets plain strings there, and an
// empty or "null" answer in such a field is read back as null.

function nullableType(schema: JsonSchema): string | null {
  const type = schema.type;
  if (!Array.isArray(type) || !type.includes('null')) return null;
  const rest = type.filter((t) => t !== 'null');
  return rest.length === 1 && typeof rest[0] === 'string' ? rest[0] : null;
}

function forNano(schema: JsonSchema, level: ConstraintLevel): JsonSchema {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (level === 'loose' && (key === 'enum' || key === 'additionalProperties')) continue;
    if (key === 'type' && nullableType(schema)) out.type = nullableType(schema);
    else if (key === 'properties' && isObject(value)) {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, isObject(sub) ? forNano(sub, level) : sub]));
    } else if (key === 'items' && isObject(value)) out.items = forNano(value, level);
    else out[key] = value;
  }
  return out;
}

function fromNano(schema: JsonSchema, value: unknown): unknown {
  if (nullableType(schema) === 'string' && typeof value === 'string' && /^(null)?$/i.test(value.trim())) return null;
  if (Array.isArray(value) && isObject(schema.items)) return value.map((v) => fromNano(schema.items as JsonSchema, v));
  if (isObject(value) && isObject(schema.properties)) {
    const properties = schema.properties;
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, isObject(properties[k]) ? fromNano(properties[k] as JsonSchema, v) : v]),
    );
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
