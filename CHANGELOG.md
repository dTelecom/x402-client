# Changelog

## 0.7.0 — 2026-11-25

- Add the optional `@dtelecom/x402-client/incentiv` module: buy credits with USDC on Incentiv Mainnet from a standard wallet (`incentiv-eoa-tx`) or an Incentiv smart account with gas in USDC or CENT (`incentiv-userop`). Uses only existing dependencies; not loaded unless imported. Client code ported from Incentiv's MIT-licensed reference implementation (see THIRD_PARTY_NOTICES.md).
- Add `paymentRail` to `DtelecomGatewayConfig`. A rail purchase signs one payment and resends that same payment while the gateway reports settlement pending.
- `BuyCreditsResponse.transaction` carries the on-chain settlement transaction when the rail reports it.

## 0.6.2 — 2026-10-27

- Publish corrected gateway pricing and the 367-character voice-agent usage example in the npm README. Documentation-only release; runtime behavior is unchanged.

## 0.6.1 — 2026-10-23

- Refresh all service guides, exact pricing, SSML/Smart Turn/watermark controls and batch retry/retention contracts.
- Add optional TTS capability catalog/audio fields and SSML generation metadata types; existing callers remain compatible.

## 0.6.0 — 2026-10-23

- Add asynchronous WAV creation, polling, streaming download and deletion with text/SSML controls and explicit watermark opt-in. Requires the separately enabled batch gateway; existing streaming APIs are unchanged.

## 0.5.0 — 2026-10-23

- Export explicit `watermark?: boolean` TTS wire controls, server availability and `TTSStreamGenerating` activation confirmation. Existing requests remain unmarked; no session or pricing API changes.

## 0.4.0 — 2026-10-22

- Export optional complete-request TTS SSML wire fields and server capability types.
- Preserve existing session APIs and plain-text speech requests.

## 0.3.0 — 2026-10-22

- Add paid text translation and persisted-result retrieval, with output-token metadata and idempotency keys.
- Export authenticated speech URL helper and STT/TTS wire types, including replaceable partial transcripts, final correlation, partial-end events and Smart Turn readiness.
- Document the enabled Kokoro/Supertonic catalog and explicit Smart Turn opt-in, with default final-only behavior preserved.
- Include opt-in vision, moderation and file-transcription clients for configured test deployments; these services remain disabled on the production gateway.
- Correct service pricing and production availability documentation.
