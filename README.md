<p align="center">
  <img src="public/icon/128.png" width="128" alt="ClaimCatcher logo">
</p>

<h1 align="center">ClaimCatcher</h1>

<p align="center">Every claim. Caught and checked.</p>

ClaimCatcher is a Chrome extension that fact-checks political videos while you watch them. Open a debate, a speech or a House floor session, click the ClaimCatcher icon, and a side panel lists the claims the speakers make. Each claim gets a card with a verdict (True, Misleading, False or Unverified), a short explanation and the sources behind it, so you don't have to pause the video to look things up.

Built for the 2026 Congressional App Challenge.

## Install

You need **Google Chrome 151 or newer** on a computer (Windows, macOS or Linux). It doesn't work on phones or in other browsers.

1. Download **[claimcatcher-0.1.0-chrome.zip](https://github.com/Fijiy/ClaimCatcher/releases/latest/download/claimcatcher-0.1.0-chrome.zip)** from the [Releases page](https://github.com/Fijiy/ClaimCatcher/releases/latest).
2. Unzip it. You get a folder with the extension inside. Keep this folder; Chrome loads the extension from it.
3. In Chrome, go to `chrome://extensions`.
4. Turn on **Developer mode** (top right).
5. Click **Load unpacked** and choose the unzipped folder.
6. A welcome page opens. Pick a mode (see below), read what the extension sends and keeps, and agree.
7. Paste your API key when asked. The welcome page links to where you make one.
8. Click the puzzle-piece icon in Chrome's toolbar and pin ClaimCatcher so its icon stays visible.

Chrome shows no permission warning when you install it. ClaimCatcher asks for more access only when a feature needs it, for example to hear a video that has no captions.

## Use it

1. Open a video, such as a debate on YouTube or a session on [live.house.gov](https://live.house.gov).
2. Click the ClaimCatcher icon (or press **Alt+Shift+L**). The side panel opens and ClaimCatcher starts listening to that tab.
3. Play the video. Claims show up as cards while people talk. Click a card to see its explanation and sources.
4. Open **Full transcript** to read everything that was said, and click **Check this** on any sentence ClaimCatcher skipped.
5. Click **Stop** when you're done. The transcript and cards are deleted when the session ends unless you save them with **Save session…** in the panel's menu.

If a video has captions, ClaimCatcher reads them. If it doesn't, ClaimCatcher asks permission to hear the tab and writes the transcript on your computer.

## Two modes

| | Local mode | Cloud mode |
|---|---|---|
| Who judges the claims | Gemini Nano, the AI model built into Google Chrome, running on your computer | An AI model at Venice that keeps nothing and trains on nothing |
| Cost | Free, with a free [TinyFish](https://agent.tinyfish.ai/api-keys) key for the web searches | You pay Venice with your own [API key](https://venice.ai/settings/api), about $1 to $2 per hour of video. You set the spending limit. |
| What leaves your computer | The search for each claim | The search, plus each claim with about 30 seconds of what was said before it and the page's title and channel |
| Needs | A computer Chrome can run Gemini Nano on: about 22 GB of free disk space, and a graphics card with more than 4 GB of memory or 16 GB of RAM | Nothing extra |

In both modes the audio and transcript stay on your computer. There is no account, no server of ours, no tracking and no ads. The panel shows an estimate of the energy and carbon each session uses, and in cloud mode what it costs.

## How accurate is it?

Not accurate enough to trust on its own yet. We tested local mode on 151 recent political claims that PolitiFact had rated and that we never tuned it on. It matched PolitiFact's rating about a third of the time (32 to 33%), which is no better than guessing. Cloud mode hasn't been measured yet.

That's why every card lists its sources and ClaimCatcher says **Unverified** when it can't find enough evidence. Treat a verdict as a starting point and read the sources. The full test results and their limits are in [docs/quality-gate.md](docs/quality-gate.md).

## Build it from source

You need Node 22.18 or newer, pnpm (through `corepack`), and Python 3.12 for the first build, which exports one of the on-device models.

```sh
corepack pnpm install
corepack pnpm build        # the extension goes to .output/chrome-mv3/
corepack pnpm test         # unit tests
corepack pnpm test:e2e     # builds, then tests the extension in Chrome with Playwright
corepack pnpm typecheck
```

The first build downloads and exports the on-device models (speech-to-text, the claim filter and voice separation) into `public/models/`, so it takes a while. Later builds reuse them.

## How it's built

- **[WXT](https://wxt.dev)**, Manifest V3, **Svelte 5** and strict **TypeScript**.
- **On-device models** with Transformers.js and ONNX Runtime Web: Moonshine for speech-to-text, a ClaimBuster model to find sentences worth checking, and pyannote and WeSpeaker to tell voices apart.
- **Gemini Nano** through Chrome's Prompt API for local mode, and **Venice** for cloud mode.
- Source ratings from a bundled Media Bias/Fact Check snapshot.

| Folder | What's in it |
|---|---|
| `src/` | The extension: the side panel, welcome page, background worker, the session that turns speech into checked claims, and the content scripts that read captions on YouTube and House pages |
| `tests/e2e/` | Playwright tests that load the built extension in Chrome |
| `scripts/` | Build scripts (models, icons, ratings snapshot) and the evaluation commands in `scripts/eval/` |
| `eval/` | The evaluation sets, frozen search results and recorded results |
| `docs/` | [Architecture](docs/ARCHITECTURE.md), [quality gates](docs/quality-gate.md) and a design decision record |

Words used in the code are defined in [GLOSSARY.md](GLOSSARY.md). Open-source licenses for bundled code and models are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
