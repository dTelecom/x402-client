# Changelog

## 0.4.0 — 2026-10-22

- Export optional complete-request TTS SSML wire fields and server capability types.
- Preserve existing session APIs and plain-text speech requests.

## 0.3.0 — 2026-10-22

- Add paid text translation and persisted-result retrieval, with output-token metadata and idempotency keys.
- Export authenticated speech URL helper and STT/TTS wire types, including replaceable partial transcripts, final correlation, partial-end events and Smart Turn readiness.
- Document the enabled Kokoro/Supertonic catalog and explicit Smart Turn opt-in, with default final-only behavior preserved.
- Include opt-in vision, moderation and file-transcription clients for configured test deployments; these services remain disabled on the production gateway.
- Correct service pricing and production availability documentation.
