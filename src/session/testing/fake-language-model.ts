// A fake `LanguageModel` factory (Chrome's Prompt API, Gemini Nano) for
// session tests. It answers each prompt by the shape of its response schema
// (claim breakdown or verdict), and behaves as Nano does when used wrongly:
// a follow-up prompt in a session crashes it, and a crash (`kErrorUnknown`,
// also on request) takes the model process down with every session in it, so
// only a session built afterwards answers. It can also hang. Every session it
// creates or clones is recorded with its prompts, so tests can count prompts.

import type { LanguageModelFactory, NanoAvailability, NanoCreateOptions, NanoSession } from '../checks/nano';
import type { JsonSchema } from '../checks/provider';

export interface FakeNanoSession {
  /** The options it was created with; a clone has its parent's. */
  options: NanoCreateOptions;
  /** The system prompt it was primed with. */
  system: string;
  /** The session it was cloned from, or null if `create()` made it. */
  clonedFrom: FakeNanoSession | null;
  /** Every prompt it received, in order. */
  prompts: string[];
  destroyed: boolean;
}

type Answer = unknown | Promise<unknown>;

export interface FakeLanguageModel {
  factory: LanguageModelFactory;
  /** Every session made, created or cloned, in order. */
  sessions: FakeNanoSession[];
  /** What `availability()` reports. Defaults to "available". */
  setAvailability(availability: NanoAvailability): void;
  onBreakdown(answer: (user: string) => Answer): void;
  onVerdict(answer: (user: string) => Answer): void;
  /** Answers claim-review prompts. Defaults to keeping every claim. */
  onReview(answer: (user: string) => Answer): void;
  /** Answers "who or what does this refer to" prompts. Defaults to "can't tell" (null). */
  onReference(answer: (user: string) => Answer): void;
  /** The next `count` prompts fail as Nano does when its process crashes. */
  crashNext(count?: number): void;
  /** The next `count` prompts never answer (until their session is destroyed or aborted). */
  hangNext(count?: number): void;
  /** The most prompts that were ever running at once. */
  maxConcurrentPrompts(): number;
  /** Prompts whose response constraint fails `accept` are refused as Chrome refuses an unsupported schema. */
  refuseSchemas(accept: (schema: JsonSchema | undefined) => boolean): void;
  /** `create()` waits for `wait()` first, as Nano does while it loads the model. */
  slowLoad(wait: () => Promise<void>): void;
}

const crash = () => new DOMException('An unknown error occurred: kErrorUnknown', 'UnknownError');

export function createFakeLanguageModel(): FakeLanguageModel {
  const sessions: FakeNanoSession[] = [];
  let availability: NanoAvailability = 'available';
  let breakdown: (user: string) => Answer = () => ({ claims: [], skipped: [] });
  let verdict: (user: string) => Answer = () => {
    throw new DOMException('no verdict scripted', 'UnknownError');
  };
  let review: (user: string) => Answer = () => ({ reason: 'A specific figure a source can settle.', kind: 'checkable fact', unclear: null });
  let reference: (user: string) => Answer = () => ({ refers_to: null });
  let crashes = 0;
  let hangs = 0;
  let running = 0;
  let acceptSchema: (schema: JsonSchema | undefined) => boolean = () => true;
  let load: () => Promise<void> = async () => {};
  let maxRunning = 0;

  function makeSession(record: FakeNanoSession): NanoSession {
    sessions.push(record);
    let abortHung: ((reason: unknown) => void) | undefined;
    return {
      async prompt(input: string, options: { responseConstraint?: JsonSchema; signal?: AbortSignal }) {
        if (record.destroyed) throw new DOMException('The model execution session has been destroyed.', 'InvalidStateError');
        if (!acceptSchema(options.responseConstraint)) throw new DOMException('Response constraint is not a supported json schema.', 'NotSupportedError');
        // A follow-up prompt: Nano crashes on these.
        const followUp = record.prompts.length > 0;
        record.prompts.push(input);
        running++;
        maxRunning = Math.max(maxRunning, running);
        try {
          await Promise.resolve();
          if (followUp || crashes > 0) {
            if (!followUp) crashes--;
            // The model process restarts: every session in it is gone.
            for (const session of sessions) session.destroyed = true;
            throw crash();
          }
          if (hangs > 0) {
            hangs--;
            await new Promise((_, reject) => {
              abortHung = reject;
              options.signal?.addEventListener('abort', () => reject(new DOMException('The request was cancelled.', 'AbortError')));
            });
          }
          const required = (options.responseConstraint as { required?: string[] } | undefined)?.required ?? [];
          const answer = await (
            required.includes('claims') ? breakdown : required.includes('kind') ? review : required.includes('refers_to') ? reference : verdict
          )(input);
          return JSON.stringify(answer);
        } finally {
          running--;
        }
      },
      async clone() {
        if (record.destroyed) throw new DOMException('The model execution session has been destroyed.', 'InvalidStateError');
        return makeSession({ options: record.options, system: record.system, clonedFrom: record, prompts: [], destroyed: false });
      },
      destroy() {
        record.destroyed = true;
        abortHung?.(new DOMException('The model execution session has been destroyed.', 'AbortError'));
      },
    };
  }

  const factory: LanguageModelFactory = {
    availability: async () => availability,
    async create(options) {
      if (availability !== 'available') {
        throw new DOMException('The device is unable to create a session to run the model.', 'NotSupportedError');
      }
      await load();
      const system = options.initialPrompts?.find((p) => p.role === 'system')?.content ?? '';
      return makeSession({ options, system, clonedFrom: null, prompts: [], destroyed: false });
    },
  };

  return {
    factory,
    sessions,
    setAvailability: (a) => void (availability = a),
    onBreakdown: (answer) => void (breakdown = answer),
    onVerdict: (answer) => void (verdict = answer),
    onReview: (answer) => void (review = answer),
    onReference: (answer) => void (reference = answer),
    crashNext: (count = 1) => void (crashes += count),
    hangNext: (count = 1) => void (hangs += count),
    maxConcurrentPrompts: () => maxRunning,
    refuseSchemas: (accept) => void (acceptSchema = (schema) => accept(schema)),
    slowLoad: (wait) => void (load = wait),
  };
}
