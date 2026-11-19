# Frozen search evidence packs

One JSON file per claim in `../rated_claims.json` (29 files, `#` in `case_id` replaced by `__`). Built 2026-10-25/26 to stand in for Brave Search in the ClaimCatcher local-mode eval.

## Method

For each claim:

1. **Query A**: the claim text verbatim, with `...` removed, plus the speaker's surname. For multi-speaker clips I used the surname of the person who made the claim: Trump, Vance, Badenoch.
2. **Query B**: one neutral, fact-only query for the core checkable fact. It has no speaker name and none of the words fact check, false, true, debunk or claim.
3. Both queries were run once through the WebSearch tool (standard mode). Results were walked in rank order, and the first 4 survivors per query were kept. Nothing was topped up across queries. `rank` is the position in that query's raw result list.
4. **Drop rules**, applied in this order:
   - `answer_url`: the URL is in `answer_urls`. Also matched: the URL's redirect target (for example `politifact.com/?p=NNN`) and the `api.politifact.com` mirror.
   - `social`: X/Twitter, Facebook, TikTok, Instagram, Reddit or YouTube.
   - `post_hoc`: coverage of this specific utterance published after the event, judged from title, URL, snippet or page text. This covers fact-checks, recaps, live coverage, transcripts of the event, and articles quoting or rating the statement.
   - `post_event`: published after the event date and discusses the event.
   - `duplicate`: same URL as a result already kept for this claim. URLs were compared after normalisation: scheme, `www.`/`api.` prefix and trailing slash ignored; `amp`/`noamp`/`m`/`fr` query parameters ignored; `/amp`, `.amp`, `.md`, `.print` and `/printable/print` variants ignored; case and percent-encoding ignored; redirect target used. Syndicated copies at different URLs were **not** de-duplicated.
   - `unfetchable`: see Deviations.
5. **Snippets.** The search tool returns titles and URLs plus one AI-written summary for the whole query. It gives no per-result text, so every snippet is `snippet_source: "fetch"`.
   - Each page was downloaded and its text extracted mechanically. The snippet is the single passage of at most 600 characters, from one paragraph, that contains the most distinct query terms; ties go to the longer passage. Passages are copied verbatim, with whitespace collapsed.
   - `published` is the page's own published-date metadata (or the PDF creation date). It is `null` if the page does not show one.
   - `title` is the page's own title where available, otherwise the title from the search tool.

## Counts

| | n |
|---|---|
| Results kept | 183 |
| Dropped: post_hoc | 98 |
| Dropped: unfetchable | 48 |
| Dropped: duplicate | 31 |
| Dropped: answer_url | 22 |
| Dropped: post_event | 1 |
| Dropped: social | 0 |

Snippet sources:

- All 183 are fetch-sourced, because the search tool gave no per-result text.
- 177 were extracted from a direct page download. This includes two GAO PDFs whose binaries came through WebFetch.
- 6 are quotes returned by the WebFetch tool, because the page blocked direct download: two BLS Real Earnings pages, the BLS CPI September 2023 page, the GAO-24-105833 product page, `gao.gov/assets/870/867438.txt` and the SME page. WebFetch caps quotes at 125 characters, so these are short. They were requested verbatim but could not be checked against the page.

## Queries where fewer than 4 results survived (kept A/B)

- cnn-2024-biden-opening-economy#4: A 0, B 3
- cnn-2024-trump-greatest-economy#0: A 3
- abc-2024-trump-springfield-pets#1: A 0
- abc-2024-harris-afghanistan-camp-david#2: A 0
- abc-2024-harris-afghanistan-camp-david#6: A 2, B 3
- cbs-2024-walz-iran-tbi-headaches#3: A 2
- cbs-2024-vance-cbp-one-mic-cut#1: B 2
- biden-sotu-2024-economy#8: A 1
- trump-joint-2025-social-security-ages#0: B 3
- trump-joint-2025-social-security-ages#1: B 2
- trump-joint-2025-social-security-ages#2: A 1
- trump-joint-2025-inflation-eggs-energy#0: A 0
- trump-joint-2025-inflation-eggs-energy#3: A 1
- johnson-speaker-acceptance-2023-prices-debt#5: A 2, B 2
- us-khanna-tiktok-2025-02-20-telehealth#0: A 0
- us-vance-peachtree-city-2025-08-21-biggest-tax-cut#1: A 0

Query A results that came back empty were almost entirely post-hoc fact-checks of the utterance itself.

## Deviations and caveats

- **Unfetchable results were skipped, not kept.** If a page could not be retrieved by direct download or by WebFetch (403, 404, DNS failure, bot wall, or a redirect to an unrelated homepage or listing page), it was dropped as `unfetchable` and the walk went on to the next result. A real Brave result would always come with a snippet, and a result without text gives a model nothing to use.
- **Many kept results are dated after the event.** 51 of the 183 kept results are dated after the event, following the brief's literal rule: they were kept because they do not discuss the event. Some of these leak verdict-like information:
  - Fact-checks of later repetitions of the same claim: trump-joint-2025-inflation-eggs-energy#2 (A1, A3, A4, A5 are December 2025 checks of the same "48 years" line), cnn-2024-trump-greatest-economy#2 A1, uk-pmqs-2025-09-03 A3 and A8, uk-pmqs-2026-03-04 B1, and us-vance-peachtree B5–B8.
  - Data published after the event, for example ONS series and post-2025 CRFB/PGPF pieces.
  - To filter strictly to pre-event evidence, drop results where `published` is later than the claim `date`. Results with `published: null` can't be filtered this way.
- **Some kept results are irrelevant.** They were kept mechanically when they were valid search results. Examples: math-journal price tables and a Spanish Johnson & Johnson article for johnson#1 query A, and a Ron Johnson quote for johnson#5 query A.
- **Syndicated copies make some packs repetitive.** Identical articles at different URLs (Fox, ABC, Sinclair and States Newsroom affiliates) each count as separate results, as the URL-only dedupe rule requires.
- **Contamination disclosure.** I did not deliberately open any answer URL. However:
  - The search tool's AI-written summaries sometimes stated fact-checkers' ratings.
  - My bulk downloader fetched every URL the searches returned, including answer-URL pages that came up in results. Their content was not used, but a page title or one-line context from them was visible to me while triaging.
  - All drop decisions were made by the rules above, not by verdict.
