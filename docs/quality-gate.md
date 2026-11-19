# The quality gates

`pnpm eval:local` and `pnpm eval:cloud` measure how well the shipped verdict step labels claims, on Gemini Nano and on the provider's models. `pnpm eval:on-device` measures the bundled on-device models: speech-to-text, the claim filter and voice separation ([below](#the-on-device-model-gates)). `pnpm eval:search` compares the searches local mode can use ([below](#the-search-comparison)). `pnpm eval:heldout` measures verdict accuracy on 151 recent fact-checked claims never tuned on ([below](#held-out-accuracy)). `pnpm eval:review` measures the claim review: cards per sentence, and rated claims still reaching a card ([below](#the-claim-review)). They are release gates, not CI tests: they need the real models (and, for the on-device gates, clip audio that is never committed), so `pnpm test` only proves their harness and scoring (`scripts/eval/*.test.ts`, with fakes).

# The verdict gate

## Current status

| | Status |
|---|---|
| Local mode (Gemini Nano) | **FAIL on real Nano** (2026-10-27; Apple M4, 16 GB, macOS 26.5.1; Google Chrome 151.0.7922.138; Gemini Nano v3Nano 2025.06.30.1229, component 2025.8.8.1141, cloned from the entrant's profile). Before #46 (`verdicts-local-2026-10-27T05-25-26.json`, the same as #46's own baseline `…05-00-14.json`): 16/29 exact, **55.6% balanced** (bar 60%), **1 True↔False error** (bar 0: a True claim called False), 3.4% Unverified, 100% repeat, **median 10.8 s** (bar 9 s), p90 13.8 s. After #46 ("Said on" in the prompt; `…05-10-59.json`, #46's run): 15/29, 52.8% balanced, 1 True↔False. The prototype's 62% / 61.6% / 0 True↔False / 8.5 s used a different prompt and harness; this is the shipped path. |
| Cloud mode (Venice) | **Not yet run: needs the entrant's API key.** Cloud mode still uses the provisional `qwen3-235b-a22b-instruct-2507` (`PROVISIONAL_MODEL` in `src/session/checks/venice.ts`), picked from Venice's docs, not measured. |

When a real run is done, replace this table with its numbers and the date, and commit its file from `eval/results/`. A wider measure, on claims the prompt was never tuned on: [Held-out accuracy](#held-out-accuracy).

## The bar

| Check | Target |
|---|---|
| True↔False errors (a True claim called False or the reverse, where the key accepts neither) | 0 (hard) |
| Balanced accuracy (mean exact-match rate over the True, Misleading and False claims) | ≥ 60% |
| Unverified (failed verdicts count, as their cards would show Unverified) | ≤ 25% of claims |
| Same label on a repeat run | ≥ 90% of claims |
| Median time per verdict, retry included | ≤ 9 s |

Every run is checked and the worst run counts; by default the gate makes two runs over the set, each on a fresh model, so the repeat check compares them. The report also gives exact and adjacent matches (adjacent also counts Misleading↔False), each split into firm and judgment mappings, the p90 time and the labels given per key label. Scoring follows `eval/README.md`, against the audited key.

## What it runs

- **Cases:** the evaluation set's 29 rated claims (`eval/clips.json`, copied as is from `task/evaluation-set`), with the claim text, about 30 s of what was said before (from a Whisper draft), the judged-as-of date (the day it was said), and the audited answer key (`eval/verdicts/key-audit.json`; the audit is `eval/verdicts/key-audit.md`). No media is in the repo.
- **Evidence:** frozen search results, two queries per claim (`eval/verdicts/evidence/`, built as its README says; fact-check articles about the claim itself were dropped). Results published after the claim's date are dropped, then the shipped evidence selection (`selectEvidence`: classify by the bundled MBFC snapshot and lists, top 5 × 400 chars, full weight first, alternating fact and claim queries) picks what the verdict step sees. One claim is left with no sources.
- **Verdict step:** the shipped `judgeClaim` (`src/session/checks/pipeline.ts`): the verdict prompt and schema (`verdict.ts`), one retry if the model fails, then the consistency rule (`consistency.ts`). It is the same function every card runs. Local mode's model is the shipped Nano adapter (`createNanoModel`, temperature 0.1, topK 1, a fresh clone per prompt); the cloud run's is the shipped provider adapter (`createVenice`).
- **Stand-ins** for what a live check has and the gate doesn't: claim breakdown isn't scored, so the literal claim is the claim's own words and there is no implied claim; the page title is the event and the channel the uploader. The speaker is named, as on a card whose speaker the page or the viewer settled.

Code: `scripts/eval/` (`eval-set.ts` cases, `gate.ts` runner, `score.ts` metrics, bar and report, `cloud-gate.ts` candidates and pick, `local.ts` and `cloud.ts` the commands). The page that holds Nano is `src/entrypoints/eval/`, built only by `wxt build --mode eval` into `.output/chrome-mv3-eval/` and never shipped.

## Running the local gate

Needs Google Chrome (not Chrome for Testing) on a machine where Chrome offers Gemini Nano: macOS 13+, Windows 10/11 or Linux, a GPU with more than 4 GB of memory or 16 GB of RAM and 4 cores, and **about 22 GB free** on the disk holding the profile.

```sh
pnpm eval:local --download   # first time: downloads Gemini Nano into the gate's profile (several GB), then runs
pnpm eval:local              # later runs
```

- It builds the eval build, opens Google Chrome on its own profile (`~/.cache/claimcatcher/eval-chrome-profile`; `--profile <dir>` or `CLAIMCATCHER_EVAL_PROFILE` to change it), loads the build through the DevTools protocol (Google Chrome ignores `--load-extension`), opens the gate page and runs the claims one at a time. Leave the window alone until it ends. One run takes about 29 × 2 × 9 s ≈ 9 minutes.
- Options: `--runs N`, `--no-build`, `--chrome <path>` (or `CHROME_PATH`) if Chrome isn't installed where Playwright looks.
- Exit code 0 if the gate passes, 1 if it fails, 2 if it can't run (not Google Chrome, Nano unavailable or not downloaded, Nano turned off mid-run).
- If Chrome says Nano is unavailable on a fresh profile, it may not have finished checking the device; the gate waits up to a minute. `chrome://on-device-internals` (enable it from `chrome://chrome-urls`) shows the model's state, crash count and version in the gate's profile.
- Chrome turns Nano off after 3 crashes; the gate stops then. Reset the count on `chrome://on-device-internals` and rerun.
- `pnpm eval:local --fake` runs the whole harness in Chrome for Testing with the fake `LanguageModel` the session tests use. Its scores mean nothing; it checks the build, the page, the adapter and the report.

### When Chrome changes its built-in model

Rerun the gate whenever Chrome updates Gemini Nano (a new Chrome major version, or a new model version on `chrome://on-device-internals`):

1. Update Google Chrome, start it on the gate's profile once (or just run the gate) and let it fetch the new model. Check the version on `chrome://on-device-internals`.
2. `pnpm eval:local`. The results file records the Chrome version; note the model version next to it in this document.
3. If the gate still passes, record the run in "Current status" above and commit the results file.
4. If it fails, local mode must not ship on that Chrome as is. Tune the verdict prompt (`verdict.ts`), the evidence shaping or the consistency rule against the gate, run the cloud gate too (the prompt is shared), and note what changed here. Prompts and thresholds are tuned against the gate, not pinned by unit tests.

## Running the cloud gate (picks cloud mode's model)

Needs the entrant's Venice API key with some credit. A full run costs well under a dollar: 58 chat requests per candidate (no search; the evidence is frozen), and Venice's reply says what each cost.

```sh
VENICE_API_KEY=… pnpm eval:cloud
pnpm eval:cloud --key-file ~/.config/claimcatcher/venice-key   # or VENICE_API_KEY_FILE
pnpm eval:cloud --models qwen3-235b-a22b-instruct-2507,mistral-small-3-2-24b-instruct
```

- **Keep the key out of the repo.** It's read from `VENICE_API_KEY` or a file outside the checkout, sent only to Venice, and never printed or written to the results. `.gitignore` also catches `*.key`, `venice-key*` and `.env*`.
- It checks the key first with Venice's free `GET /api_keys/rate_limits` and stops if Venice refuses it or reports no credit. A model the key can't use (401, such as a paid-plan-only model) is skipped; running out of credit mid-run stops the gate.
- **Candidates** are read live from `GET /models?type=text`: `private` (never `anonymized`), non-reasoning, with JSON-schema output (`supportsResponseSchema`, which `venice.ts` relies on), and not being retired. These are the must-haves in the orchestrator's ruling; `e2ee-*` is a preference among models that pass. Today no `e2ee-*` model has schema output without reasoning, so none is a candidate. On 2026-10-26 Venice listed 10 candidates, including `qwen3-235b-a22b-instruct-2507`, `qwen3-next-80b`, `mistral-small-3-2-24b-instruct`, `google-gemma-3-27b-it` and `nvidia-nemotron-3-nano-30b-a3b`.
- **The pick** is a model that clears the bar: an `e2ee-*` one if any does, then the highest balanced accuracy (worst run), then the fastest median, then the cheapest. If none clears it, the command says so and exits 1; keep the current model and record that here.
- To apply the pick: set `PROVISIONAL_MODEL` in `src/session/checks/venice.ts` to it and update its comment, replace the cloud row of "Current status" with the run's numbers, cost and date, and commit the results file from `eval/results/`.
- `pnpm eval:cloud --fake` runs the harness against a fake Venice, without a key.

## Caveats

- The prompt design was tuned on these same 29 claims, on one M4 Mac, so the gate is optimistic.
- The evidence is frozen search results from one search tool, not Venice's own search; some kept results are irrelevant and syndicated copies repeat (see the evidence README).
- The speed bar is measured on the gate machine; slower devices take longer.

# Held-out accuracy

How often local mode's verdicts (Gemini Nano judging TinyFish search results) agree with a professional fact-checker, on **151 recent claims it was never tuned on**. Not a gate, and nothing was tuned on it: no prompt, rule or threshold has been changed because of these claims. Run it again after any verdict change and compare with the baseline below. Never tune on it: the 29-claim gate is the tuning set.

## Baseline (2026-10-27)

`eval/results/heldout-2026-10-27T05-37-15.json`, two runs, each on a fresh model, of the integration branch with #46 (claims carry the day said as `saidOn`). Machine: Apple M4 (10 cores, 16 GB), macOS 26.5.1, Node 22.23.2, Google Chrome 151.0.7922.138, Gemini Nano v3Nano 2025.06.30.1229 (component 2025.8.8.1141, an APFS clone of the entrant's model). No other Chrome used Gemini Nano during the run (checked every 10 s). The Mac idle-slept once in run 1 (22:44–23:01), which made one verdict take 1,036 s; the median and p90 hardly move, and the label isn't affected.

The set: 51 True, 58 Misleading, 42 False (mapped from PolitiFact; 131 firm mappings, 20 judgment), said 2025-01-08 to 2026-10-20 (112 in 2026), no Unverified in the key. Intervals are 95%: Wilson for rates, a stratified bootstrap (10,000 resamples) for balanced accuracy.

| | Run 1 | Run 2 |
|---|---|---|
| **Balanced accuracy** | **32.2%** [24.9%, 39.7%] | **32.8%** [25.5%, 40.3%] |
| Exact match | 49/151 = 32.5% [25.5%, 40.3%] | 50/151 = 33.1% [26.1%, 41.0%] |
| Exact, True claims | 24/51 = 47.1% [34.1%, 60.5%] | 24/51 = 47.1% |
| Exact, Misleading claims | 15/58 = 25.9% [16.3%, 38.4%] | 16/58 = 27.6% |
| Exact, False claims | 10/42 = 23.8% [13.5%, 38.5%] | 10/42 = 23.8% |
| Adjacent (Misleading↔False counts) | 64/151 = 42.4% [34.8%, 50.4%] | 65/151 = 43.0% |
| Unverified | 42/151 = 27.8% [21.3%, 35.4%] | 41/151 = 27.2% |
| Exact when a label was given | 49/109 = 45.0% [35.9%, 54.3%] | 50/110 = 45.5% |
| **True↔False errors** | **16**: True→False 5, False→True 11 | 16: 5, 11 |
| Firm mappings: exact / adjacent | 45/131 = 34.4% / 57/131 = 43.5% | the same |
| Judgment mappings: exact / adjacent | 4/20 = 20.0% / 7/20 = 35.0% | 5/20 / 8/20 |
| Failed verdicts | 0 | 0 |

Same label on both runs: 150/151 = **99.3%** [96.3%, 99.9%]. Time per verdict: **median 7.3 s**, p90 10.9 s.

Confusion, run 1 (rows: PolitiFact, mapped; columns: ClaimCatcher):

| | True | Misleading | False | Unverified |
|---|---|---|---|---|
| True (51) | 24 | 14 | 5 | 8 |
| Misleading (58) | 15 | 15 | 6 | 22 |
| False (42) | 11 | 9 | 10 | 12 |

**Read plainly: on claims it hasn't seen, local mode's verdicts are no better than chance.** Answering "Misleading" every time would score 33.3% balanced (38.4% exact) on this set; a uniform guess, 33.3% balanced. Local mode scores 32–33%. It does far worse than on the 29-claim gate (55.6% balanced), which the prompt was tuned on and whose frozen evidence was assembled by hand. And it calls 11 of 42 False claims True.

### Why, as far as the data shows (exploratory, not tuned on)

`pnpm eval:heldout-report eval/results/heldout-2026-10-27T05-37-15.json` re-scores the run by how much evidence each claim had:

| Claims | Balanced (run 1) | Exact | Unverified | True↔False |
|---|---|---|---|---|
| All 151 | 32.2% [24.9, 39.7] | 32.5% | 27.8% | 16 |
| With at least one source (117) | 39.7% [31.2, 48.4] | 41.0% | 7.7% | 16 |
| With three or more sources (71) | 43.5% [31.8, 55.4] | 45.1% | 7.0% | 6 |

- **Evidence starvation (the test's, not the product's):** 34 claims have no source left after the leak filter, and Nano correctly says Unverified on 33 of them, which counts as a miss. The filter is strict on purpose (`eval/heldout/README.md`): searching in October 2026 for claims said months earlier, undated pages and later coverage have to go. A live check on the day would have more to go on. Even with three or more sources, though, it agrees with the fact-checker less than half the time.
- **Echoes counted as support:** for many False claims (mostly campaign attack lines: "X believes America deserved 9/11", "X wants to raise your taxes by $7,500") the only pages from before the claim are the attacker's own release or coverage repeating the line, and Nano takes a source repeating the claim as confirming it.
- **Label against its own conclusion:** some False→True verdicts say the opposite in their conclusion ("Sources confirm that Mayor Mamdani does not require ID…", labelled True; "The sources show Abdul El-Sayed did condemn the attack", labelled True). The consistency rule doesn't catch a conclusion that contradicts the claim under a True label. This is the clearest lead for a verdict-quality pass, to be tuned on the 29-claim gate only.

## What you can say on camera

> "We tested ClaimCatcher's on-device mode on 151 recent political claims that PolitiFact had rated, none of which we had tuned it on, with the fact-checks themselves and anything published after each claim removed from its evidence. It matched PolitiFact's verdict about a third of the time: 33%, with a 95% range of 25 to 40%, which is no better than chance. It gave the same answer on a repeat run 99% of the time, with each verdict worked out on the laptop itself in about seven seconds. On-device fact-checking isn't reliable yet, and that's why ClaimCatcher shows its sources on every card."

The exact defensible claim: *on 151 PolitiFact-rated US political claims said between January 2025 and October 2026, local mode's balanced accuracy was 32–33% (95% CI about 25–40%) against PolitiFact's ratings mapped to True / Misleading / False, on one M4 Mac with Chrome 151's Gemini Nano.* Its caveats, to say or show:

- **Sample:** 151 claims, one fact-checker (PolitiFact), its choice of claims; intervals about ±8 points.
- **Dates:** said 2025-01 to 2026-10, mostly 2026, mostly campaign ads, posts and interviews.
- **Rating mapping:** Half True counted as Misleading, Mostly False split by judgment (20 claims); the set is balanced by design (PolitiFact's own mix is 72% False or worse), so exact accuracy here is not accuracy on "claims politicians make".
- **Evidence filtering:** searched months later, with professional fact-checks, pages calling themselves fact-checks, anything dated after the claim and anything undated removed; 34 claims were left with no evidence. That is harder than a live check on the day, so this is a lower bound on the evidence side, but even well-sourced claims scored under 50%.
- **Not tested here:** cloud mode (Venice; no key), claim breakdown (the claim's own words are the query and the claim), what was said before the claim.

Do **not** say it "catches false claims" or quote the 29-claim gate's 55.6% as accuracy: that set was used to tune the prompt.

## How it runs

```sh
pnpm eval:heldout-evidence --tinyfish-key-file ~/.tinyfish-key   # once: freezes the evidence (done; committed)
pnpm eval:heldout                                                # the verdicts on Gemini Nano, 2 runs (~45 min)
pnpm eval:heldout-report eval/results/heldout-<time>.json        # re-score a run, with the evidence splits
```

- **Set and evidence:** `eval/heldout/` (its README says how both were built, and their limits). The verdict step gets each claim's frozen `evidence` (the shipped TinyFish adapter, selection and balancing search, after the leak filter), the claim as literal claim with no implied claim and no preceding speech, the speaker, "<speaker> in <venue>" as the page title, and the day said as both `judgedAsOf` and `saidOn`.
- **Verdict step:** the shipped `judgeClaim` on the shipped Nano adapter, as `pnpm eval:local` runs it (same build, profile and options: `--runs`, `--download`, `--no-build`, `--chrome`, `--profile`). Keep Chrome's other Nano users idle while it runs, and stop the Mac sleeping (`caffeinate -i`).
- **Scoring** (`scripts/eval/heldout-score.ts`, tested): exact = the mapped label; balanced = mean exact rate over True, Misleading and False; adjacent also counts Misleading↔False; Unverified counts as a miss; True↔False errors; firm and judgment mappings apart; repeat agreement across runs.

# The on-device model gates

`pnpm eval:on-device` runs three gates on the bundled models, on clip audio fetched by `pnpm eval:fetch`.

## Current status

Run 2026-10-26 on an Apple M4 (10 cores, 16 GB, macOS 26.5.1), Node 22.23.2, Chrome for Testing 151.0.7922.34 headless, 4 WASM threads, cross-origin isolated; recorded in `eval/results/on-device-2026-10-27T01-28-31.json`. Every gate passes.

| Gate | Bar | Result | First run (`on-device-2026-10-27T00-37-37.json`) |
|---|---|---|---|
| Speech-to-text (Moonshine base, 8-bit) | WER ≤ 10% | **PASS**, 9.2% (329 errors in 3,580 words); 4.3% of real time | PASS, 9.7% |
| Claim filter (claimbuster-detector, 8-bit per channel, threshold 0.45) | ≥ 90% of rated claims caught, ≤ 40% of sentences passed | **PASS**: 93.1% of rated claims (27/29), 38.8% passed (109/281); 83.8% of all 80 check-worthy claims | FAIL: 82.8%, 37.0% (8-bit per tensor, 0.5) |
| Voice separation (pyannote 3.0 + WeSpeaker, 8-bit) | ≥ 90% of speech on the right voice, every session | **PASS**: CNN 96.9%, ABC 93.4%, CBS 90.2%, PMQs 92.4%; the whole ABC debate (95 min) 92.6%; 3.6% of real time | FAIL: CNN 64.0%, ABC 92.9%, CBS 86.0%, PMQs 89.2%, debate 92.7% |

Three changes since the first run, each measured by the gate:

- **A real low-pass resampler.** The tab's audio reaches the models through the 48 → 16 kHz resampler in `src/audio/pcm.ts`. It was an area average, a weak low-pass (6 kHz 0.6 dB down, 9 kHz only 5 dB down), so sound above 8 kHz folded into the speech band. It is now a Kaiser-windowed sinc (flat to 6.6 kHz, −6 dB at 7.2 kHz, at least 96 dB down from 7.8 kHz), evaluated polyphase at each output sample's exact input position: no delay, and the same samples however the frames are split. With it alone (`on-device-2026-10-27T01-10-01.json`), CNN went from 64.0% to 96.9% (Biden and Trump no longer merge into one voice) and WER from 9.7% to 9.2%. That matches feeding ffmpeg-resampled audio in the first run (97.9%, 8.6%). The other voice sessions moved by about a point either way (ABC 91.3%, CBS 85.3%, PMQs 88.8%, debate 91.0%).
- **The claim filter quantized per channel.** With one scale per weight matrix, the 8-bit model in ORT-web's WASM runtime scored rated claims lower than the full-precision model the threshold was picked on: 24/29 at 0.5, and no threshold met both halves of the bar. `scripts/claim-filter/export.py` now quantizes with `per_channel=True` (same size, 67.6 MB; the same bytes on two runs, pinned in `scripts/models.ts`). In the browser it meets the bar at every threshold from 0.40 to 0.49 (27/29 kept; 112 → 105 sentences passed). At 0.50 it misses a rated claim whose best sentence scores 0.4998; at 0.39 it passes one sentence too many. `PASS_THRESHOLD` is 0.45, the middle of that range, so no single score near it decides the gate: the nearest sentences score 0.408 and 0.460.
- **Crosstalk goes to a voice.** pyannote marks stretches where two people speak at once. They used to be dropped, so in CBS's mic-cut exchange 13.3% of the labelled speech got no voice, more than the bar allows whatever the clustering did. Now `tasks/voice-separation.ts` keeps them, marked `overlap`, and the clustering gives each to the voice it sounds most like. Such a stretch never starts a voice and never changes a voiceprint, because it mixes two people. Speech given no voice fell to 3.2% in CBS and 3.6% in PMQs (from 13.3% and 7.1%).

**The clustering thresholds were left as they are** (`src/audio/voice-clusters.ts`: new voice below 0.4 from a segment of at least 2 s, merge above 0.5). The run's voiceprints were replayed offline through the clustering. Every new-voice threshold from 0.35 to 0.5 with a merge threshold from 0.5 to 0.7 gives exactly the scores above. Below 0.35, Biden and Trump merge again (CNN 63.7%). From 0.6, ABC and the debate make extra voices. Shortening the 0.6 s minimum stretch would add about a point on PMQs, ABC and the debate (0.3 s: CBS 90.5%) but wasn't done: short stretches make unsteady voiceprints, and it would be tuning to this set.

**The margin is thin on CBS** (90.2%, about 0.3 s of 133 s of speech). Its crosstalk is the hardest material in the set, and one person still gets three voices (JD Vance, 35 s). The whole debate holds over 95 minutes, with 6 voices for 4 speakers (Trump split over 2 in the labelled stretches). A model or reference change that costs CBS a point will fail the gate there first.

## The bars

| Gate | Target | How it's scored |
|---|---|---|
| Speech-to-text | WER ≤ 10% | `eval/README.md`'s rules: both sides normalised the same way (lowercase, no punctuation, `%` → percent, no commas in numbers, gonna → going to, hyphens split), fillers dropped from what was heard, `NAME:` labels dropped, each `[unclear: …]` a wildcard that matches any run of words at no cost and isn't counted. Errors pooled over all 17 clips. The reference is machine consensus of Whisper large-v3 and Parakeet; Moonshine isn't Whisper-family, so no friendly-reference caveat applies. |
| Claim filter | ≥ 90% of the 29 rated claims caught, ≤ 40% of sentences passed | The 281 sentences of the reference transcripts (`eval/filter/sentences.json`, from the prototype: split after `.` `?` `!`, each marked with the claims it holds; all 80 of the set's claims are found). A claim is caught when any sentence holding it passes the shipped `ClaimFilter` (`createClaimFilter`, `PASS_THRESHOLD`). The report adds recall on all 80 check-worthy claims and a threshold sweep from the same scores. |
| Voice separation | ≥ 90% of labelled speech on the right voice, in every session | 100 ms frames of reference speech; each voice is mapped to one speaker (greedily, most shared frames first), so a speaker split over two voices loses the second's frames, and speech given no voice counts as wrong. The report adds voices per speaker (voices holding ≥ 1 s of their speech) and voices made per session. |

Sessions (`eval/voices/sessions.json`): four broadcasts from the set, each its clips played in order on one page (CNN 2, ABC 2, CBS 2, PMQs 1; a jump between clips is a seek), with speaker turns from the prototype (labelled reference lines aligned to Whisper word timings; nobody listened), and **one whole debate**: ABC's presidential debate, 2024-09-10, from "Good evening" to "Good night" (60–5,775 s of the upload, about 95 minutes, breaks included). Only its two clips are labelled, so it is scored there, after 29 and 73 minutes of continuous clustering; the voices made are counted over all of it.

## What it runs

- **The shipped path, not a copy.** The gate builds the eval build and opens its page (`src/entrypoints/eval/`) in Chrome for Testing, where it starts the shipped model worker (`startModelWorker`, the same tasks, models and WASM runtime as the offscreen document). The shipped clients run in Node and send each model call to the page (`runModel` on the bridge; audio and voiceprints cross as exact base64, `wire.ts`): the transcriber (`createTranscriber`: resampling to 16 kHz, pieces of 5–15 s cut at pauses), `createSpeechToText`, `createClaimFilter` and `createVoiceSeparation` (the voice clustering in `voice-clusters.ts`, with merges applied to earlier lines as the session does).
- **Audio** goes in as a tab gives it: 48 kHz mono frames with media times, a quarter of a second each. The gate plays faster than real time but waits for the models after each frame (`scripts/eval/play.ts`), so no piece is dropped for falling behind, as it can be live on a slow device. Timings are model time including the bridge.
- The voice gate turns separation on from the first piece and leaves speech-to-text out (it has its own gate).

Code: `scripts/eval/` (`fetch-audio.ts` and `media.ts` the audio, `play.ts` the transcriber driver, `wer.ts`, `filter.ts`, `voices.ts` cases, scoring and reports, `on-device.ts` the command).

## Running them

Needs yt-dlp and ffmpeg on PATH (`brew install yt-dlp ffmpeg`), about 700 MB of disk, and Playwright's Chrome for Testing (installed with the e2e tests).

```sh
pnpm eval:fetch        # once: the clips (≈ 25 min of audio) and the whole debate, into eval/media/
pnpm eval:on-device    # every gate: a few minutes on the M4, 3.5 of them the whole debate
```

- `eval:fetch`: `--clips` (skip the whole debate), `--only <id,…>`, `--force`. It keeps files already there. YouTube, X, TikTok and parliamentlive.tv go through yt-dlp (audio only; a short window is fetched alone, at about real time, a long one as the whole file); live.house.gov has no yt-dlp extractor, so the House player's API gives the archive's HLS manifest and ffmpeg cuts it (the Johnson clip's times are on that manifest's timeline). Every file is cut to exactly its window: sample 0 is the window's start. Exit 2 if a tool is missing, 1 if a clip failed.
- **Never commit media.** `eval/media/` is git-ignored. Fetching YouTube with a tool is against its terms (`eval/README.md`, "Terms"); it is done once, for this private measurement, and nothing is redistributed.
- `eval:on-device`: `--only stt,filter,voices`, `--no-full` (voices without the whole debate), `--no-build`, `--media <dir>` (another copy of the audio, for experiments; the record names it), `HEADED=1` to watch. Exit 0 if every gate passes, 1 if any fails, 2 if it can't run (audio missing).
- Each run writes `eval/results/on-device-<time>.json`: the machine (CPU, memory, OS, Node, browser, model runtime), every score, what speech-to-text heard per clip, the filter's score per sentence, and the voices given. Commit the run a decision rests on and update "Current status" above.
- Rerun after changing a model, its quantization, the filter threshold, the clustering thresholds, which stretches voice separation keeps, the resampler or the transcriber's piece cutting.

## Caveats

- Every reference is machine-made and nobody listened: transcripts (Whisper + Parakeet consensus), sentence-to-claim marks (word matching), speaker turns (Whisper word timings, ± a few tenths of a second).
- The filter's sentences come from the reference text split on punctuation, not from the live sentence builder, which cuts speech-to-text pieces by its own rules.
- The whole debate is labelled only where its clips are (196 s of 95 minutes).
- One machine. WASM threads and speed differ by device; scores should not.

# The claim review

`pnpm eval:review` measures what claim breakdown and the claim review (ticket #46) do to the evaluation set: how many sentences end as cards, and whether the claims fact-checkers rated still reach one. The claim filter gate's bar holds for the filter, breakdown and review together: **at least 90% of the 29 rated claims reach a card.**

## Current status

Gemini Nano, Chrome 151.0.7922.138 (an APFS clone of the entrant's model), 2026-10-27 — **PASS**: `eval/results/review-2026-10-27T04-19-47.json`.

| | Before the review | After |
|---|---|---|
| Sentences ending as cards (of 281) | 109 (38.8%) | 105 (37.4%) |
| Cards per sentence the filter passed | 1.47 | 1.29 |
| Rated claims reaching a card (bar ≥ 90%) | 27/29 (93.1%) | **27/29 (93.1%)** |
| All 80 check-worthy claims reaching a card | 67/80 (83.8%) | 65/80 (81.3%) |

Dropped by the review or as not self-contained: 9 not self-contained ("They cut the defence budget", "She has not welcomed the Norway deal", "Their retirement security is under attack"), 9 opinions ("This budget resolution is the Doge resolution", "each one is a literal act of hope"), 1 too vague. The two rated claims missing are the filter's (the same two as the filter gate). "Before the review" is already after #46's code checks, which drop the duplicate claims Nano gives (the old breakdown gave every on-device sentence of the entrant's video two identical claims).

The first run (`review-2026-10-27T03-18-25.json`) failed, 22/29: "not self-contained" counted "this country" and "this Labour government", there was no second try at naming a pronoun, and clips' pages were their events ("CNN Presidential Debate, Atlanta"), so "he" in "The only jobs he created" couldn't be named. Since then only a pronoun or a bare "that" counts, `resolve.ts` tries once to name it from what was said and the page, and the pages are the clips' real titles. One later guard (a referent that is itself a pronoun, "many of them", is refused) came after the passing run; on it, it changes nothing (that claim was dropped either way).

### The verdict prompt's "Said on" (#46), on the same Nano

#46 also tells the verdict step the day a claim was said ("Said on: …", and that time words count from it); the gate's cases now pass it (`saidOn`, the clip's date). On the same Gemini Nano (Chrome 151.0.7922.138, cloned model), 2 runs each, the 29-claim gate fails before and after, by about one claim either way: before #46 (`verdicts-local-2026-10-27T05-00-14.json`) 16/29 exact, balanced 55.6%, 1 True↔False, 3.4% Unverified, median 10.8 s; with #46's prompt (`verdicts-local-2026-10-27T05-10-59.json`) 15/29 exact, balanced 52.8%, 1 True↔False, 6.9% Unverified, median 10.4 s; repeat 100% both. Seven of 29 labels moved, in both directions: Nano's labels shift with any change to the prompt's words. A longer wording of the time rule scored 15/29, 51.9%, and was dropped. Of the claims that turn on a time word, "the worst inflation in 48 years", "prices have increased over 17 percent in the last 2 years", "the smallest in 20 years" and "as of today, not one member of the military…" kept their labels; "15 million new jobs in three years, a record" (True → Misleading) and "the biggest boost to defence spending since the Cold War" (Misleading → True) moved. A real Nano rerun on a larger set is what would settle it.

## What it runs

- The evaluation set's 281 reference sentences (`eval/filter/sentences.json`, the filter gate's), and the shipped claim filter's verdict on each from a recorded `pnpm eval:on-device` run (its per-sentence scores at `PASS_THRESHOLD`; `--filter-run` picks one).
- For each sentence the filter passed: the shipped `findClaims` (`src/session/checks/pipeline.ts`): claim breakdown, its code checks (`tidy.ts`), one try at naming words no one named (`resolve.ts`), and the claim review (`review.ts`), on Gemini Nano in the gate's extension page. Each sentence's page is its clip's title and channel as the site shows them (`eval/review/pages.json`: YouTube's, read on 2026-10-27; the event and account elsewhere), said on the clip's date, with the clip's earlier sentences (up to 80 words, ~30 s) as context.
- A claim reaches a card when a sentence holding it passes the filter and keeps at least one claim after the review (a sentence whose model call failed counts: it would end as one Unverified card). "Before the review" counts the claims breakdown gave after its code checks.

## Running it

- `pnpm eval:review --profile <Chrome profile with Gemini Nano>`; `--fake` proves the harness without Nano; `--limit N` for a quick look; `--no-build`, `--chrome <path>`. Exit 0 if the bar holds, 1 if not, 2 if it can't run. Each run writes `eval/results/review-<time>.json` with every sentence's claims before and after and why each was dropped.
- About 15–25 s a sentence on Nano (breakdown is the slow part): 40–50 minutes for the 109 sentences the filter passes.
- Rerun after changing the breakdown, naming or review prompts or schemas, `tidy.ts`, or the filter threshold.

## Caveats

- Tuned on the same set it is scored on, on one Mac: optimistic.
- Sentence-level: a sentence holding a rated claim that keeps any card counts, even if the card is another claim from it (as for the filter gate).
- Cloud mode's model isn't measured here (no Venice key).

# The search comparison

`pnpm eval:search` compares the two searches local mode offers (ticket #45): Venice's (the provider's key) and TinyFish's (a free key). It isn't a pass/fail gate: it is what the choice of local mode's default search rests on. A third, DuckDuckGo's results page (no key), was built and measured here, refused every request, and was dropped (the entrant's decision); its measurement stays below as the reason.

## Current status

Run 2026-10-26 on an Apple M4 (16 GB, macOS), Google Chrome 151.0.7922.138, Node 22.23; recorded in `eval/results/search-2026-10-27T01-24-53.json` (TinyFish and DuckDuckGo, one second between claims) and `eval/results/search-2026-10-27T01-41-48.json` (DuckDuckGo again, 20 seconds between claims). 29 rated claims. The DuckDuckGo column is from the adapter as it was then; it is no longer in the extension or in `pnpm eval:search`.

| | Venice | TinyFish | DuckDuckGo |
|---|---|---|---|
| Ran? | **No: no Venice key here** | yes | yes, twice, but **refused**: every request (see below) |
| Requests (failed) | | 65 (0) | 58 (58), twice |
| Results per query | | 9.6 | 0 |
| Results dated after the claim (dropped) | | 325 of 554 (**miscounted**, see below the table) | |
| Usable after classification (each link once, after the date filter) | | 136 of 227 (60%); 79 at full weight; 83 dropped (user-generated, excluded), 8 partisan | |
| Claims with 5 sources / none | | 15 / 1 (frozen evidence: 14 / 1) | 0 / 29 |
| Top 5s: L, LC, C, RC, R | | 7, 9, 12, 2, 0 | |
| Top 5s: Primary / unrated | | 44 / 32 | |
| Balancing search ran | | 7 of 29 claims | |
| Latency per request, median / p90 | | 1.8 s / 2.8 s (from Node) | |
| Overlap with the frozen top 5: domains / links | | 7% / 0% | |
| Verdict gate on its evidence | not run | **not run: Gemini Nano isn't on this machine's gate profile** (`downloadable`; the download wasn't taken, with 22 GB free) | not run |

**The date filter in this run was wrong** (found 2026-10-27, building the held-out set; fixed in `search-compare.ts`, not rerun). TinyFish dates results as ISO dates, "Jun 10, 2026" or "3 weeks ago"; the filter compared those strings with the claim's ISO date, so every "Mon D, YYYY" result counted as after the claim whatever its day ("J" sorts after "2"), and every relative one was kept, though for these 2023–2025 claims a page from weeks before the run is always later. The one dated source left in TinyFish's top 5s is "2 days ago". So the TinyFish column above dropped good, older sources and let some later ones through; its counts and top 5s should be rerun (`pnpm eval:search --only tinyfish`) before they are relied on. The choice of TinyFish as the default doesn't rest on them alone (it answered every request, free, with a free key).

DuckDuckGo, two runs (why it was dropped):

- `search-2026-10-27T01-24-53.json` (one second between claims): the first request from the eval page got DuckDuckGo's bot challenge (202), the next 24 too, then every request a 403 ("If this persists, please email us"), and from then on even an ordinary Chrome tab got the 403, for 30 to 75 minutes. This connection had made about 20 probing searches earlier that day.
- `search-2026-10-27T01-41-48.json` (20 seconds between claims, about two requests a claim), started minutes after an ordinary Chrome tab on the same connection got ten results again: the first 31 requests from the extension page got the challenge, the other 27 the 403. Not one result.

So DuckDuckGo told the extension's request apart from a person's: a tab's navigation got results, the extension page's `fetch` (the request the offscreen document makes: `Origin: chrome-extension://…`, `Sec-Fetch-Mode: cors`, no cookies) got the challenge every time, then the whole connection was turned away. A third check, by hand at 19:13: a tab got ten results, then seconds later the extension page's GET got the challenge, so did a GET with a browser's `Accept` and `Accept-Language`, and a POST of DuckDuckGo's own form got the 403. In this form DuckDuckGo search doesn't work: every check ends Unverified, "DuckDuckGo refused the search…". Before the runs, ordinary headed Chrome got ten results per query (status 200, `a.result__a`), headless Chrome always got the challenge, and any query with `OR` in it always did.

What this means for the default: TinyFish is local mode's preselected search. It answered every request, gave about as many full top 5s as the frozen evidence, and is free with a free key (30 a minute, 500 an hour). Venice's search is the other choice (the provider's key, no retention). DuckDuckGo was dropped: as measured it refused the extension's every search, so every claim would have ended Unverified. Making it work would need the request to look like a page's own (for example rewriting `Origin` and `Sec-Fetch-*` with `declarativeNetRequest`, a further permission) on top of its optional host permission `https://html.duckduckgo.com/*`, which is gone from the manifest with it. Low overlap with the frozen top 5 says TinyFish finds other pages for the same queries, not worse ones; the verdict gate on its evidence (`--verdicts`, needs Nano) is what would show that.

## What it runs

- **Cases:** the verdict gate's 29 rated claims, each with the two queries its frozen evidence was searched with (`eval/verdicts/evidence/*.json`: B, a neutral fact query, as the `fact` query; A, the claim verbatim plus the speaker's surname, as the `claim` query). The queries aren't claim breakdown's own (it isn't scored here), so every search gets the same ones.
- **The shipped path:** each query goes through the shipped adapter (`createVenice(…).search`, `createTinyFishSearch`) with the pipeline's one retry; results that may be dated after the claim are dropped (TinyFish's "Jun 10, 2026" and "3 weeks ago" forms read by `result-dates.ts`; as for the frozen evidence; a live check doesn't do that, so the gate's pools are smaller than a live session's); then the shipped selection (`selectEvidence`: link cleaning, classification by the bundled MBFC snapshot and lists, top 5 × 400 characters) and the shipped balancing search (`searchOtherSide`, through the same adapter: Venice with `site:` operators, TinyFish with `include_domains`).
- **Measured per search:** requests and why any failed; results per query and queries with none; how many results (each link once) are usable after classification, and at full weight; claims with a full top 5 and with none; the top 5s across L / LC / C / RC / R, Primary and unrated; how often the balancing search ran; latency per request (median, p90; retry included); and overlap with the frozen top 5 (share of its domains, and of its links, also in this search's top 5).
- **The verdict gate on each search's evidence** (`--verdicts`): the verdict gate (`judgeClaim` on Gemini Nano, same bar and scoring as `pnpm eval:local`) on the frozen evidence and on each search's top 5s. It needs Gemini Nano on the gate's Chrome profile (`--download` takes it, several GB).
- **Where it runs:** Venice and TinyFish are called from Node with the keys given. Google Chrome (the eval build's gate page) is started only for `--verdicts`.

Code: `scripts/eval/search-compare.ts` (measures, table), `scripts/eval/search.ts` (the command), `scripts/eval/search-compare.test.ts`.

## Running it

```sh
pnpm eval:search --tinyfish-key-file ~/.tinyfish-key --venice-key-file <file>   # every search
pnpm eval:search --only tinyfish                                                 # TinyFish alone
pnpm eval:search --verdicts                                                      # and the verdict gate on Nano
```

- Keys come from `VENICE_API_KEY` / `TINYFISH_API_KEY`, or the files named by `--venice-key-file` / `--tinyfish-key-file` (or `VENICE_API_KEY_FILE` / `TINYFISH_API_KEY_FILE`). Each goes only to its own service and is never printed or written down. A search without a key is skipped, and the run says so.
- `--only venice,tinyfish`, `--pause-ms N` between claims (default 1000), `--runs N` for the verdict gate, `--no-build`, `--chrome <path>`, `--profile <dir>` (default `~/.cache/claimcatcher/eval-chrome-profile`, shared with `pnpm eval:local`).
- Each run writes `eval/results/search-<time>.json`: the machine, what was skipped, each search's summary and every claim's requests, counts and top 5 (domains, links, ratings), and the verdict gate's scores if run. Commit the run a decision rests on and update "Current status" above.
- Costs: TinyFish nothing; Venice about $0.01 a request (about 65 requests, so about $0.65).

## Caveats

- Live searches change from day to day, and favour recent pages: the as-of filter drops many of their results for claims from 2023–2025, which the frozen evidence (gathered nearer the time) didn't lose.
- The overlap measure compares with one frozen search, not with a right answer. Low overlap says the searches find different pages, not that they find worse ones; the verdict gate on each search's evidence is the measure of that.
- DuckDuckGo's numbers (kept as the reason it was dropped) depended on the connection: a burst of searches (or probing) from one IP address got every later request refused for a while.

