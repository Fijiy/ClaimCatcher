// Typed messages between the four parts of ClaimCatcher:
//
//   background  the service worker: a thin router (icon, badge, permissions)
//   offscreen   the offscreen document: owns the session
//   panel       the side panel: display only
//   reader      a caption reader injected into the listened tab
//   pill        the on-video pill injected into the listened tab
//
// Every message names its receiver in `to`. `runtime.sendMessage` reaches every
// extension context, so each listener answers only messages addressed to it.
// Add a message here first; the compiler then shows every place to handle it.

import { browser, type Browser } from 'wxt/browser';
import type { CaptionSegment, Mode, PageContext, SearchId, SessionEvent, SessionSettings, SessionView, StopReason, VoiceId } from './session/types';
import type { LocalModel } from './local-model';
import type { ModelRuntime } from './models/protocol';
import type { KeyId, Setup } from './settings';

export type Message =
  // panel or pill -> background
  | { to: 'background'; type: 'stop-listening' }
  // panel, first-run page / Privacy & data -> background
  | { to: 'background'; type: 'get-setup' }
  /**
   * The viewer agreed to this mode and search (first run, or a switch: then a session sending to the old
   * destination stops). Cloud mode always searches at the provider, whatever `search` says.
   */
  | { to: 'background'; type: 'give-consent'; mode: Mode; search: SearchId }
  /** Saves a key the page has checked with its service (the provider's by default, or TinyFish's). */
  | { to: 'background'; type: 'save-api-key'; key: string; which?: KeyId }
  | { to: 'background'; type: 'forget-api-key'; which?: KeyId }
  // panel -> background: Replay, through the listened tab's activeTab grant
  | { to: 'background'; type: 'replay'; tabId: number; time: number }
  // panel -> background
  | { to: 'background'; type: 'listen-again'; tabId: number }
  | { to: 'background'; type: 'get-switch-request' }
  | { to: 'background'; type: 'answer-switch'; confirm: boolean }
  // pill -> background
  | { to: 'background'; type: 'show-panel' }
  | { to: 'background'; type: 'get-panel-shown' }
  // offscreen -> background: the session on `tabId` stopped itself (e.g. the key was refused)
  | { to: 'background'; type: 'session-stopped'; tabId: number; reason: StopReason }
  // offscreen -> background: Clear now emptied a stopped session, so nothing in the offscreen document is needed now
  | { to: 'background'; type: 'session-cleared' }
  // panel -> background: after Allow, open the blocked player's page again in a new tab, at the same moment
  | { to: 'background'; type: 'reopen-in-new-tab'; tabId: number }
  // background -> offscreen
  | { to: 'offscreen'; type: 'start-session'; tabId: number; page: PageContext; settings: SessionSettings }
  | { to: 'offscreen'; type: 'stop-session'; reason: StopReason }
  /** The viewer forgot the key or switched mode: a stopped session sends nothing more with its settings. */
  | { to: 'offscreen'; type: 'settings-withdrawn' }
  | { to: 'offscreen'; type: 'page-changed'; tabId: number; page: PageContext }
  // reader -> offscreen (straight there; the router doesn't relay segments)
  | { to: 'offscreen'; type: 'caption'; segment: CaptionSegment }
  // panel -> offscreen
  | { to: 'offscreen'; type: 'get-snapshot' }
  | { to: 'offscreen'; type: 'clear-session' }
  /** The viewer's "Check this" on a transcript line. */
  | { to: 'offscreen'; type: 'force-check'; lineId: string }
  /** The viewer's answer to "Who said this?" on a card. */
  | { to: 'offscreen'; type: 'speaker-answer'; cardId: string; name: string }
  /** The viewer's answer to "Who is this?" on a new voice's first claim: its name, or Skip. */
  | { to: 'offscreen'; type: 'voice-name'; voice: VoiceId; name: string }
  | { to: 'offscreen'; type: 'voice-skip'; voice: VoiceId }
  /** "Tell voices apart for this video". */
  | { to: 'offscreen'; type: 'separate-voices' }
  /** How the on-device model worker runs (threads, WebGPU), for diagnostics and tests. */
  | { to: 'offscreen'; type: 'get-model-runtime' }
  // background -> offscreen: whether local mode can run (the worker has no LanguageModel)
  | { to: 'offscreen'; type: 'get-local-model' }
  | { to: 'offscreen'; type: 'source-opened'; url: string }
  /**
   * panel -> offscreen: a tabCapture stream ID for the listened tab's blocked player. The panel gets it, not the
   * service worker: Chrome ties an ID to the process that asked for it, and only extension pages share the
   * (cross-origin isolated) offscreen document's process.
   */
  | { to: 'offscreen'; type: 'use-tab-stream'; tabId: number; streamId: string }
  // offscreen -> panel
  | { to: 'panel'; type: 'session-event'; event: SessionEvent }
  // background -> panel: a click on a second tab asks before switching (null: no question)
  | { to: 'panel'; type: 'switch-request'; request: SwitchRequest | null }
  // background -> reader (sent with tabs.sendMessage)
  | { to: 'reader'; type: 'stop-reading' }
  // background -> pill (sent with tabs.sendMessage)
  | { to: 'pill'; type: 'panel-shown'; shown: boolean }
  | { to: 'pill'; type: 'remove-pill' };

/** "Stop listening on <first tab> and listen here?": the tab the viewer clicked on. */
export interface SwitchRequest {
  tabId: number;
}

export type Receiver = Message['to'];
export type MessageTo<R extends Receiver> = Extract<Message, { to: R }>;

/** What each message is answered with. Messages not listed get no answer. */
interface Replies {
  'get-snapshot': SessionView;
  'clear-session': SessionView;
  'get-switch-request': SwitchRequest | null;
  'get-panel-shown': boolean;
  /** False when the tab can't be listened to without a new click on the icon. */
  'listen-again': boolean;
  'get-setup': Setup;
  'give-consent': Setup;
  'save-api-key': Setup;
  'forget-api-key': Setup;
  /** Whether the video was found and sought. */
  replay: boolean;
  'stop-session': SessionView;
  'get-model-runtime': ModelRuntime | null;
  'get-local-model': LocalModel;
  /** Whether the tab's audio is now captured with it. */
  'use-tab-stream': boolean;
  /** Whether the new tab opened. */
  'reopen-in-new-tab': boolean;
}
export type ReplyTo<M extends Message> = M['type'] extends keyof Replies ? Replies[M['type']] : void;

export type Sender = Browser.runtime.MessageSender;

/** Receivers that live in a web page, reached with `tabs.sendMessage`. */
type InTab = 'reader' | 'pill';

/** Sends to the extension's own pages and service worker. */
export function sendMessage<M extends Exclude<Message, { to: InTab }>>(message: M): Promise<ReplyTo<M>> {
  return browser.runtime.sendMessage(message) as Promise<ReplyTo<M>>;
}

/** Sends to the scripts injected in one tab (the caption readers and the pill). */
export function sendToTab<M extends MessageTo<InTab>>(tabId: number, message: M): Promise<ReplyTo<M>> {
  return browser.tabs.sendMessage(tabId, message) as Promise<ReplyTo<M>>;
}

function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && 'to' in value && 'type' in value;
}

/** The message of type `T` that receiver `R` accepts. */
type MessageOfType<R extends Receiver, T extends string> = Extract<MessageTo<R>, { type: T }>;

/** One handler per message type the receiver accepts; the compiler checks none is missing. */
export type Handlers<R extends Receiver> = {
  [T in MessageTo<R>['type']]: (
    message: MessageOfType<R, T>,
    sender: Sender,
  ) => ReplyTo<MessageOfType<R, T>> | Promise<ReplyTo<MessageOfType<R, T>>>;
};

/**
 * Listens for messages addressed to `receiver`; everything else is left for
 * other listeners. A handler's return value (or resolved promise) is the reply.
 * The handler runs synchronously inside the listener, so a user gesture the
 * message carries (a click in a content script) is still live in it, as
 * `sidePanel.open()` needs. Returns a function that removes the listener.
 */
export function onMessage<R extends Receiver>(receiver: R, handlers: Handlers<R>): () => void {
  const listener = (raw: unknown, sender: Sender, sendResponse: (reply?: unknown) => void) => {
    if (!isMessage(raw) || raw.to !== receiver) return undefined;
    // Safe: `raw.to === receiver`, so `raw.type` names one of the receiver's handlers.
    const handler = (handlers as unknown as Record<string, ((message: Message, sender: Sender) => unknown) | undefined>)[raw.type];
    if (!handler) return undefined;
    let reply: unknown;
    try {
      reply = handler(raw, sender);
    } catch (error) {
      reply = Promise.reject(error);
    }
    Promise.resolve(reply).then(
      (value) => sendResponse(value),
      (error: unknown) => {
        console.error(`[ClaimCatcher] ${receiver} failed on "${raw.type}"`, error);
        sendResponse(undefined);
      },
    );
    return true; // keeps the channel open for the async reply
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
