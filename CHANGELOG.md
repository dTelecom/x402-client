# Changelog

## 0.7.1 — 2026-11-25

- Fix purchases with current `@x402/*` releases (2.x with client spend controls), which a fresh install resolves to: `buyCredits` now caps each payment at exactly the requested amount instead of the library's default $1, so purchases above $1 work again on Base and Solana. A quote above the requested amount is refused.
- Fix the Incentiv rail with current `@x402/*` releases: its payment schemes declare Incentiv USDC as a known asset (`findDefaultAsset`).
- Fix Solana wallet auth with real `@solana/kit` signers: `signMessages` returns signature bytes, which were treated as a base58 string (`value.split is not a function`). Base58 strings from custom signers are still accepted.
- Widen the `@solana/kit` peer range to `>=5.1.0`, so `npm install @dtelecom/x402-client @x402/svm @solana/kit` resolves with current `@x402/svm` (which requires kit 8).
- Tested against `@x402/*` 2.32.0 and `@solana/kit` 8.6.0.

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
