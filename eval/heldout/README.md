# The held-out accuracy set

151 recent US political claims, each rated by PolitiFact, said between 2025-01-08 and 2026-10-20. It is for measuring how often ClaimCatcher's local mode (Gemini Nano verdicts on TinyFish search results) agrees with professional fact-checkers on claims it was never tuned on. None of them is in the 29-claim verdict gate (`eval/clips.json`), and the verdict prompt has not been changed because of them. Results and how to read them: `docs/quality-gate.md`, "Held-out accuracy".

Files:

- `claims.json`: the claims, their metadata and the mapped label. No article text: the claim is PolitiFact's one-line statement of what was said, and the mapping notes are our own words.
- `evidence/<id>.json`: each claim's frozen search evidence (`pnpm eval:heldout-evidence`), described below.
- `evidence-summary.json`: totals over the frozen evidence.

## A claim

```jsonc
{
  "id": "pf/<speaker slug>/<fact-check slug>",   // from the fact-check's link
  "claim": "…",          // PolitiFact's statement of the claim (a leading "Says" dropped)
  "speaker": "…",        // a person or a named organisation (campaign, PAC, party, agency)
  "said": "YYYY-MM-DD",  // the day it was said: the judged-as-of date the verdict step gets
  "venue": "an ad",      // where it was said, as PolitiFact gives it
  "factCheck": { "publisher": "PolitiFact", "url": "…", "published": "YYYY-MM-DD", "authors": ["…"], "rating": "Half True" },
  "label": "True | Misleading | False",
  "basis": "firm | judgment",
  "mappingNote": "…"      // judgment mappings only: why, in one sentence
}
```

## How it was built (2026-10-26)

1. **Source.** PolitiFact's lists by rating (`politifact.com/factchecks/list/?ruling=<rating>`, paged until each list reached claims said before 2025), for True, Mostly True, Half True, Mostly False, False and Pants on Fire. Each list card gives the speaker, "stated on <date> in <venue>", the claim, the rating and the link. Each picked claim's fact-check page was then fetched to confirm the rating (the page's meter), the speaker, the date said, the publication date and the authors.
2. **ClaimReview.** The brief asked for schema.org ClaimReview markup where available. PolitiFact's current site serves none (checked on the fact-check pages, also as Googlebot), and neither does FactCheck.org; the fields above come from PolitiFact's visible markup instead. That is also why the set has one publisher: the narrative fact-checkers (FactCheck.org, AP, Reuters) give no rating to read, so every one of their claims would be a judgment mapping.
3. **Eligible.** Said from 2025-01-01 to 2026-10-26; a named speaker (posts PolitiFact attributes only to "Social Media", "X posts", "Facebook posts", "TikTok posts", "Instagram posts", "Threads posts", "Viral image" and the like were left out: they aren't someone speaking); in English (PolitiFact en español's claims left out); a US speaker (one non-US speaker left out); not a claim of the 29-claim set (3 PolitiFact links in common were left out; no remaining claim is a near-copy of one of the 29 by text); and a fact-check page that still loads (2 returned 404 and were left out).
4. **Picked.** Most recently said first: every eligible True (17), the 34 most recent Mostly True, the 50 most recent Half True, the 20 most recent Mostly False (at most 2 per speaker), the 20 most recent False (at most 3 per speaker) and the 10 most recent Pants on Fire (at most 3 per speaker). The caps keep one speaker from filling the False side (Donald Trump has 18 claims in the set).
5. **Mapped** by `eval/README.md`'s rules (`mapRating` in `scripts/eval/heldout.ts`, checked against this file by its tests):

| PolitiFact | Label | Basis | In the set |
|---|---|---|---|
| True, Mostly True | True | firm | 17 + 34 |
| Half True | Misleading | firm | 50 |
| Mostly False | Misleading if the literal fact is about right but the impression is wrong, else False | judgment, from the fact-check's ruling | 20: 8 Misleading, 12 False |
| False, Pants on Fire | False | firm | 20 + 10 |

The result: **51 True, 58 Misleading, 42 False** (131 firm, 20 judgment), no Unverified (PolitiFact has no such rating; one Mostly False whose ruling says the evidence doesn't establish the claim went to False under the README's "no evidence where evidence contradicts" rule). 112 were said in 2026, 39 in 2025.

### Base rates: why the set is not a random sample

PolitiFact's ratings skew heavily False. Over all its claims said from 2025-01-01 to 2026-10-26 (as listed on 2026-10-26): 498 False, 124 Pants on Fire, 103 Mostly False, 61 Half True, 52 Mostly True, 20 True (858). Counting only named speakers (the eligible pool before picking): 151 False, 43 Pants on Fire, 88 Mostly False, 57 Half True, 50 Mostly True, 18 True (407).

The set takes nearly every True, Mostly True and Half True claim and samples the False side, so the three labels are roughly balanced. That is deliberate: an "always False" checker would score 72% exact on PolitiFact's mix and tell you nothing. So report **balanced accuracy** (the mean of the exact-match rate on True, Misleading and False claims) first. Exact accuracy on this set is not accuracy on "claims politicians make": that mix is unknown, and fact-checkers choose what to check.

## The frozen evidence (`pnpm eval:heldout-evidence`)

Each claim's searches went through the shipped TinyFish adapter (`createTinyFishSearch`, with the pipeline's one retry), on 2026-10-26/27, with the key read from a file outside the repo (never printed or written down):

- **Queries.** Claim breakdown isn't run (as in the 29-claim gate, where claim breakdown isn't scored either), so the queries are mechanical stand-ins: the fact query is the claim's own words without quote marks, the claim query the same plus the speaker's name. A live check would search with breakdown's own queries.
- **Leaks dropped**, before the shipped selection sees anything, and counted per claim by reason:
  - `fact-checker`: a professional fact-checker on the product's own list (`src/session/sources/fact-checkers.ts`: PolitiFact, FactCheck.org, Snopes, AP/Reuters/USA TODAY/Washington Post/CNN fact-check desks and others). Live, these are shown as sources ("PolitiFact rated this…"); here they would be the answer.
  - `fact-check-words`: any other page whose title, snippet or link says "fact check", "PolitiFact", "Truth-O-Meter" or "Pants on Fire" (syndicated copies of the fact-check, fact-checks by outlets not on the list).
  - `after-said`: dated after the day said. TinyFish dates come as ISO dates, "Jun 10, 2026" or "3 weeks ago"; relative ones are read from the time of the search, rounded down as search engines do ("3 weeks ago" is 3 to 4 weeks before).
  - `maybe-after-said`: a relative date whose range straddles the day said ("7 months ago" for a claim said 7 months ago). Dropped, to be safe.
  - `after-said-link-date`: no date given, but the link carries a later one (`/2026/10/03/`, `/2026/oct/03/`, `-2026-10-03`, or a later `/2026/11/` month).
  - `undated`: no date that can be read, from TinyFish or the link. Searched months later, such a page can't be shown to predate the claim, and the first freeze showed what gets through otherwise: aggregator copies of the PolitiFact check with its exact headline (headtopics.com, newsbreak.com), WRAL's republished PolitiFact pieces, Wikipedia articles edited since, and live data tables ("Electricity Rates by State (October 2026)"). A live check on the day would have had many of these pages, as they were then; here they are lost.
  - The day said itself is kept, as in the 29-claim gate. Professional fact-checks published *before* the claim (AP's "Fact Focus" on a rumor a candidate repeated later) are kept when no rule above catches them: a live check could have found them too.
- **Then the shipped pipeline after search:** the shipped selection (`selectEvidence`: link cleaning, classification by the bundled MBFC snapshot and lists, user-generated pages dropped, partisan pages set aside as context, top 5 × 400 characters, full weight first, alternating queries) and the shipped balancing search (`searchOtherSide`, TinyFish's `include_domains`) when the top 5 lean one way, its results filtered the same way.
- **Order of work:** the first freeze (2026-10-27, 03:00–03:30 UTC) kept undated results; a look at what reached the verdict step showed the leaks above, so the `undated` rule was added and the frozen searches re-filtered (`--refilter`: the stored fact and claim results replayed with their earlier drops kept, the rules applied again, only balancing searches sent). No verdict had been run on this set at that point. In numbers: the looser rules gave the verdict step 528 sources (76 claims with five, 11 with none); the strict ones give 377 (44 with five, 34 with none).
- **What's kept:** every result in rank order per query (title, link, domain, date, and the snippet for kept ones; dropped ones keep no snippet) with why any was dropped, the requests and their times, and `evidence`: exactly the sources the verdict step is given, as the product sends them. A relative date on a kept source is turned into the latest day it can be (TinyFish's words are kept as `publishedAsGiven`), so "3 weeks ago" doesn't read as relative to the day of the run. `pnpm eval:heldout` reads only `evidence`, so a rerun judges the same sources.

### Limits of the evidence

- Searching in October 2026 for claims said months earlier isn't what a live check sees: the as-of filter removes later coverage and every undated page, which leaves far fewer sources than a live check on the day would have (34 of 151 claims get none and can only end Unverified). This makes the measured accuracy a **lower bound** on the evidence side.
- The leak filter is a set of rules, not a reading. A page's date is the search's or its link's: a page dated before the claim but edited after it gets through. The 14 sources dated only by their link are counted in `evidence-summary.json`.
- Mechanical queries are not breakdown's queries; "Says" and pronoun-heavy claims ("they", "this bill") search worse than breakdown's rewrites would.

## Limits of the set

- **One publisher** (PolitiFact) and its choice of what to check; its ratings are a judgment, and two fact-checkers can rate the same claim differently.
- **151 claims**: intervals are wide (about ±8 points on exact accuracy, more per label).
- **Recent:** 2025-01 to 2026-10, mostly 2026, heavy on midterm-campaign ads and posts; spoken claims (speeches, debates, interviews) are a minority of venues, though ClaimCatcher hears speech.
- **Mapping:** Half True → Misleading and the Mostly False split are the README's convention, not PolitiFact's; the 20 judgment mappings were made by the agent who built the set, from the fact-checks' rulings, and are reported separately.
- **No surrounding speech:** the verdict step gets no "what was said before" context (the 29-claim gate gives ~30 s), and the page title is a stand-in ("<speaker> in <venue>").
- The agent who built the set read the fact-checks' rulings (needed for the judgment mappings) and wrote the leak rules after looking at search results (two claims', then the kept evidence of all of them, for leaks); neither the prompt nor the pipeline was changed after seeing them, and no verdict had been run on the set when the rules were set.
