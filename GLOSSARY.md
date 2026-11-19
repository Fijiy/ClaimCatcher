# ClaimCatcher

A browser extension that listens to political video in a tab and fact-checks what speakers claim, while the viewer watches.

## Language

**Viewer**:
The person watching political video online with the extension running; the target user is any voter.
_Avoid_: User (in product copy), customer

**Local mode**:
Operating mode where claims are judged by an AI model on the viewer's own device. Transcription happens on the device in every mode, and source search always goes out to the web.
_Avoid_: Offline mode, private mode

**Cloud mode**:
Operating mode where claims are judged by an AI model at a private-first provider.
_Avoid_: Online mode, server mode

**Private-first provider**:
A third-party AI or search service whose terms rule out training on, or retaining, the viewer's data, for every party in its chain, not just the service the viewer picks.
_Avoid_: Secure provider, trusted provider

**API key**:
The viewer's own credential with a provider or a search, which the viewer pays for (the provider's) or gets free (TinyFish's); ClaimCatcher has no server and holds no keys of its own.
_Avoid_: Token, account, login

**Search**:
Where the search queries written from the claims go: the provider's private search in cloud mode; in local mode the one the viewer chose, TinyFish's search API (a free key, the default) or the provider's. Only one at a time, agreed to like a mode.
_Avoid_: Search engine (in product copy), crawler

### Transcript

**Captions**:
The page's own captions, read from the player; the preferred source of the transcript.
_Avoid_: Subtitles (in product copy), CC

**On-device transcript**:
The transcript made on the viewer's device by speech-to-text on the tab's audio; it takes over when captions are missing for about 10 s while audio is flowing, and hands back when they return.
_Avoid_: ASR, auto-captions, STT (in product copy)

### Claims

**Claim**:
A single checkable statement of fact taken from what a speaker said; one compound sentence can yield several claims. It is written to stand alone: who and what its words refer to are named, and time words ("last year", "in 48 years") are counted from the day it was said. The speaker's own words stay on the card.
_Avoid_: Statement, quote

**Self-contained**:
A claim that names who and what it is about, so someone who never saw the video can check it. One whose "they" no one named (after one try at naming it from what was said and the page) isn't, and is skipped (never searched); words for the speaker ("I", "we") are settled by the speaker prompts instead.
_Avoid_: Decontextualised (in the product)

**Claim review**:
The step after claim breakdown and before any search that keeps a claim only if it is a specific, verifiable statement of fact, self-contained, and worth checking (not vague, not trivially true). What it drops is a skipped statement with its reason; a forced check skips it.
_Avoid_: Second filter, check-worthiness model

**Premise**:
A checkable claim embedded in a skipped statement, such as the fact a promise rests on; it is checked as a claim in its own right.

**Implied claim**:
What the listener is meant to conclude from a claim, beyond its literal words.
_Avoid_: Subtext, spin

**Skipped statement**:
Speech that holds no checkable claim: opinion, value judgement, hyperbole, rhetorical question, prediction or promise; or a claim the claim review dropped as not self-contained, too vague to check, or not worth checking.
_Avoid_: Non-claim, filtered claim

**Speaker**:
The person who said a claim, named from the page, by the viewer, or through the voice the viewer named; never inferred from what the claim says.
_Avoid_: Candidate, participant, voice

**Voice**:
One person's voice as voice separation tells it apart in the tab's audio, on the device: "Voice A", "Voice B" until the viewer names it ("Who is this?"), and then the speaker of its claims. Two voices given the same name are one.
_Avoid_: Speaker (a voice has no speaker until it is named), diarization cluster

**Forced check**:
A check the viewer requests on any transcript line, overriding the decision to skip it.

### Verdicts

**Verdict**:
ClaimCatcher's finding on one claim: a label, a one-line conclusion, the sources on both sides, and the date it is judged as of.
_Avoid_: Rating, score, result

**True**:
The label for a claim the sources support, literally and in what it implies.

**Misleading**:
The label for a claim whose literal words hold up but whose implied claim does not; it always says what is missing.
_Avoid_: Missing context (as a label), Half true, Technically true

**False**:
The label for a claim the sources contradict.

**Unverified**:
The label for a claim with too little evidence, or where credible sources disagree; it is shown, never hidden.
_Avoid_: Unverifiable, Unknown, Disputed

**Conclusion**:
The one-line, plain-words explanation that accompanies every label.
_Avoid_: Summary, reasoning

**Judged-as-of date**:
The date a verdict is judged against: when the claim was said if known, otherwise the day it is checked.
_Avoid_: Timestamp, check date

### Sources

**Bias rating**:
A third party's left-to-right placement of a news outlet, shown on each source it covers.
_Avoid_: Lean, slant, partisanship score

**Reliability rating**:
A third party's judgement of how trustworthy an outlet is for facts, used to weight how much a source counts.
_Avoid_: Credibility, trust score, factuality

**Primary source**:
An original record rather than reporting about it: an official data agency, court, legislature or academic journal. It counts as fully reliable.
_Avoid_: Official data source, government source (too broad)

**User-generated source**:
A post on a social or video platform. It is never evidence for a verdict.
_Avoid_: Social source, UGC

**Partisan source**:
A political office, campaign or party site; it may be shown for context but is never the deciding source for any claim.
_Avoid_: Biased source, government source
