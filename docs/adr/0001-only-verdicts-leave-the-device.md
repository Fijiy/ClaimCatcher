# Only the verdict step differs between local and cloud mode

Audio capture, the transcript (page captions first, bundled on-device speech-to-text otherwise) and the check-worthiness filter always run on the viewer's device; local and cloud mode differ only in where the LLM that writes claims, search queries and verdicts runs. We chose this so audio never leaves the device in any mode, so the on-device filter can drop most sentences before any LLM sees them (the biggest energy lever), and so cloud mode needs only the one provider (LLM and search) decided in the "Who pays" ticket, with no speech-to-text vendor. The cost is lower transcription accuracy than cloud streaming speech-to-text, and no cloud speaker diarization.

## Considered Options

- **Cloud speech-to-text in cloud mode** (e.g. Soniox): more accurate, can tell speakers apart, but sends audio off-device and adds a vendor and key.
- **LLM-only claim detection**: simpler, but about 4× the LLM calls and the whole transcript leaves the device in cloud mode.
- **Per-stage toggles**: flexible, but hard to explain on the consent page and to test.

## Consequences

- Local mode is the default when the device can run it, even though research found local inference is not reliably greener; privacy decides here, not footprint.
- Local mode ships only if it passes a measured quality bar; devices that can't run it see it disabled with a reason, never a silent cloud fallback.
