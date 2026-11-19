# Whetstone evaluation set: political clips with known fact-checks

Built for [Build the evaluation set of debate clips with known fact-checks](https://github.com/Fijiy/CAC/issues/18) and used by [Is local mode good enough to ship, and does Chrome use Gemini Nano or an open model?](https://github.com/Fijiy/CAC/issues/19). Assembled 2026-10-25.

It measures four things: transcript accuracy, how many check-worthy claims the filter recalls, verdict quality against professional fact-checkers, and latency.

`clips.json` holds 17 clips, about 24.5 minutes of video in total. No media is stored here: each clip is a URL plus a start and end time, and the harness plays it in a browser tab, which is how Whetstone is really used.

## Coverage

| | |
|---|---|
| Clips | 17: 6 debates (CNN, ABC, CBS VP, all 2024) · 3 addresses to Congress (Biden SOTU 2024, Trump 2025 joint address ×2) · 3 House/Senate floor · 2 UK PMQs · 3 social video (Khanna on TikTok, Vance rally and Warner on X) |
| Floor / chamber video | Booker (Senate) and Murray (Senate), both from the Senators' official channels; Johnson (House), from live.house.gov; plus the 3 addresses, recorded in the House chamber |
| Captions on the source | 11 human (often live-broadcast CC), 3 auto only (CBS ×2, Booker), 3 none (Khanna TikTok, Vance X, Warner X) |
| Rated claims | 29 in total: 14 Republican, 13 Democratic, 1 Conservative (UK), 1 Labour (UK) |
| Mapped labels | 8 True · 13 Misleading · 8 False · **0 Unverified** |
| Mapping basis | 12 firm (a PolitiFact rating with a fixed mapping), 17 judgment (narrative checks or Mostly False; each justified in `mapping_note`) |
| Unrated check-worthy claims | 51, with `ratings: []` and `mapped_label: null`, so filter recall can be measured on everything check-worthy, not only on the rated claims |
| Speaker-attribution stress | Crosstalk and moderators in the Springfield (ABC) and CBP One (CBS) clips; heckling in the Trump Social Security clip; two leaders in the Badenoch PMQs clip |

One clip, `us-warner-x-2025-07-21-russia-interference`, has no professionally rated claim. It stays in the set only as an uncaptioned speech-to-text and filter-recall sample.

## Schema

The array in `clips.json` has one object per clip:

- `id`, `title`, `group` (`debates` · `floor` · `uncaptioned`), `event`, `date`, `kind` (debate · floor · address · parliament · other)
- `speakers[]`: `name`, `party`, `role`. Moderators have the party `none`.
- `video`: `url`, `platform`, `uploader`, `official_uploader`, `start_s`, `end_s`, and `timestamps_verified`. That last field says how the times were found: `asr` (word timings from two speech models; every clip since 2026-10-25), `captions` (from a caption track) or `unverified` (estimated).
- `terms`: `copyright`, `terms_summary`, `terms_url`, `eval_use_note`
- `captions`: `available`, `kind` (`human` · `auto` · `none`), `how_checked`
- `reference_transcript`: `text`, `source_url`, `source_kind`, `fidelity` (`machine consensus` · `verbatim` · `lightly cleaned` · `edited`), `needs_listening_check`. See [Reference transcripts](#reference-transcripts).
- `claims[]`: `text` (as spoken), `approx_s`, `ratings[]` (`org`, `rating` in the org's own words, `url`, `date`), `mapped_label`, `mapping_basis` (`firm` · `judgment`), `mapping_note`
- `notes`: what an evaluator must know about the clip

## Reference transcripts

Nobody listened to the clips. Each reference transcript was made by machine consensus on 2026-10-25, and every clip has `fidelity: "machine consensus"`:

- Two independent speech models transcribed every clip with word timings: Whisper large-v3 (OpenAI, run with mlx-whisper) and Parakeet TDT 0.6B v2 (NVIDIA, run with parakeet-mlx).
- Where the two agree, that wording stands. Where they disagree, the side the published transcript backs wins. Anything still in conflict is written as `[unclear: <Parakeet> | <Whisper>]`, with `(nothing)` for an empty side.
- Across about 3,700 words, the published text settled 87 conflicts between the models, and 32 are left `[unclear]`. No clip has more than 5.
- Fillers (uh, um) are left out. Repeats and restarts that both models heard are kept, e.g. "Every Everybody".
- Speaker labels come from the published transcripts (`NAME:` at the start of a line). The CBS mic-cut clip was labelled by hand. A speaker-embedding comparison showed that CBS's transcript swaps two lines (see that clip's `notes`).
- The clip window is where the published passage actually sits in the audio. Uncaptioned clips are the whole video, except Vance, whose window was chosen by reading the transcript.

How to score speech-to-text against these:

- Normalise both sides the same way: lowercase, strip punctuation, `15%` → `15 percent`, drop `,` in numbers, `gonna` → `going to`, split hyphens. Drop fillers from the hypothesis and drop `NAME:` labels.
- Treat each `[unclear: …]` as a wildcard that matches any 0–N hypothesis words. Don't count errors inside it.
- Caveat: one of the two models is Whisper, so a Whisper-family model under test gets a slightly friendly reference. Report the agreement-only words (outside `[unclear]`) and say so.

## How professional ratings map to Whetstone's four labels

| Professional rating | Whetstone label |
|---|---|
| PolitiFact True, Mostly True | True |
| PolitiFact Half True | Misleading |
| PolitiFact Mostly False | Misleading if the fact-check says the literal fact is accurate or nearly so but the impression is wrong; otherwise False (judgment) |
| PolitiFact False, Pants on Fire | False |
| FactCheck.org, AP, Full Fact, Washington Post (narrative, no scale) | Judged from the article; the key sentence is quoted in `mapping_note` |
| "Can't be determined", or experts disagree | Unverified. No claim in the set got this label. |
| "No evidence", where the evidence contradicts the claim | False |

Every claim is judged as of the date it was said, matching Whetstone's judged-as-of rule.

Scoring suggestions for the harness:

- Report exact-match accuracy. Also report "adjacent" accuracy, which counts Misleading↔False as a near miss because about half the mappings are judgment calls.
- Report `firm` and `judgment` claims separately.

## Known gaps — read before scoring

1. **Reference transcripts are machine consensus, not human-verified.** See [Reference transcripts](#reference-transcripts). Where both models mishear the same way and the published text has no say (Khanna, Vance and Warner have no full published text), an error can survive. Some of the measured error rate will be the reference's, not the system's.
2. **Times come from speech-model word timings,** usually within a few tenths of a second; they weren't checked by ear. The windows were re-cut to the spoken passage, so the two CNN clips now meet at 313.4 s instead of overlapping. Johnson's times moved onto the HLS/DASH manifest timeline, about 201 s later than the old caption-based times. Whether the HouseLive player's clock shows manifest time is unchecked: check one seek before the first run.
3. **No Unverified ground truth.** Professional fact-checkers almost never publish a "can't tell" verdict, so this set can't measure how well Whetstone uses Unverified. Watch for over-use instead: any Unverified on a rated claim counts as a miss.
4. **CBS's published transcript swaps two speakers.** Walz says "Those laws have been on the books since 1990", and Vance replies "The CBP app has not been on the books since 1990…". CBS has these the other way round. Settled by voice comparison and the picture; `clips.json` has the corrected labels.
5. **Linked, not loaded.**
   - Biden's 800,000 manufacturing jobs: the rating is PolitiFact's Mostly True for a near-identical statement from December 2023, not this sentence.
   - Two standalone PolitiFact checks are cited through the CNN debate roundup.
   - The Trump 2025 ratings come from PolitiFact's live roundup, not standalone pages.

## Terms

- **Congressional and White House video:** public domain under 17 U.S.C. §105.
- **Debates:** owned by the networks (CNN/WBD, ABC/Disney, CBS/Paramount).
- **parliamentlive.tv:** Parliamentary copyright, with no party-political, satire or advertising use. Hansard is under the Open Parliament Licence. The parliamentlive terms page returned 403, so re-confirm.
- **C-SPAN:** none of its content is used. Its terms bar AI use.
- **Transcript pass downloads:** to make the reference transcripts, each clip's window was downloaded once with yt-dlp to a scratch folder outside the repo, despite YouTube's terms. Nothing was committed.
- **No redistribution:** this repo stores only URLs, times and short transcript excerpts. The repo is private.
- **YouTube's Terms of Service** bar accessing the service "using any automated means". A harness that plays YouTube clips by script, rather than with a person driving the tab, may fall under that, so run it with a person at the keyboard.

## Findings along the way that matter elsewhere

- **Caption lag:** live broadcast captions ran about 2–6.5 s behind the audio (ABC and CNN uploads, parliamentlive.tv). YouTube auto-captions are aligned to the audio. This feeds [Does tab-audio capture actually work on the debate sites we care about?](https://github.com/Fijiy/CAC/issues/15).
- **Garbled human captions:** CNN's human captions on its own upload are badly garbled. So "human captions" doesn't mean accurate, and captions-first could feed Whetstone a worse transcript than on-device speech-to-text would.
- **Uncaptioned video is rare:** YouTube, Rumble, CBS and most X/TikTok videos now carry auto-captions. Captions-first therefore covers most viewing. The on-device speech-to-text path mostly serves native X and TikTok video and some news-site players.
- **"Uncaptioned" video often has captions in the picture:** Khanna's TikTok and Warner's X video both have word-by-word captions burned in. The extension can't read pixels, so they still count as uncaptioned for it.
- **yt-dlp misses some captions:** it reports no captions on CNBC's player even though the page links a WebVTT file. Check a player's manifest directly; don't rely on yt-dlp.
