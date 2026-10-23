# @dtelecom/x402-client

TypeScript SDK for the [dTelecom x402 gateway](https://x402.dtelecom.org) — buy credits with USDC and use WebRTC, streaming speech, translation, file transcription with diarization, text/SSML-to-WAV, vision and audio/image moderation.

Uses the [x402 HTTP payment protocol](https://www.x402.org/) for on-chain micropayments on Base and Solana.

## Install

**EVM (Base):**

```bash
npm install @dtelecom/x402-client @x402/fetch @x402/evm viem
```

**Solana:**

```bash
npm install @dtelecom/x402-client @x402/fetch @x402/svm @solana/kit
```

## Quick Start (EVM)

```typescript
import { DtelecomGateway } from '@dtelecom/x402-client';
import { privateKeyToAccount } from 'viem/accounts';

const gateway = new DtelecomGateway({
  account: privateKeyToAccount(process.env.WALLET_PRIVATE_KEY as `0x${string}`),
});

// Buy credits ($0.10 USDC on Base)
const purchase = await gateway.buyCredits({ amountUsd: 0.10 });
console.log(`Credits: ${purchase.creditedMicrocredits}`);

// Create agent session (WebRTC + STT + TTS bundle)
const session = await gateway.createAgentSession({
  roomName: 'tutor-room-123',
  participantIdentity: 'ai-tutor',
  clientIdentity: 'student-1',
  clientIp: '203.0.113.42',       // optional — routes client to nearest SFU
  durationMinutes: 10,
  language: 'en',
});

console.log(session.webrtc.agent.token);   // JWT for agent's WebRTC connection
console.log(session.webrtc.client.token);  // JWT for client's WebRTC connection
console.log(session.stt.token);            // Token for STT server
console.log(session.tts.token);            // Token for TTS server
```

## Quick Start (Solana)

```typescript
import { DtelecomGateway } from '@dtelecom/x402-client';
import { generateKeyPairSigner } from '@solana/kit';

const signer = await generateKeyPairSigner();
// Or load from file: import { createKeyPairSignerFromBytes } from '@solana/kit';

const gateway = new DtelecomGateway({
  solanaAccount: signer,
});

// Same API as EVM — buyCredits, createAgentSession, etc.
const purchase = await gateway.buyCredits({ amountUsd: 0.10 });
```

## Wallet Support

### EVM

The SDK accepts a viem `LocalAccount` — the standard interface for server-side wallets:

```typescript
// Private key
import { privateKeyToAccount } from 'viem/accounts';
const account = privateKeyToAccount('0x...');

// Coinbase CDP server wallet
import { toAccount } from 'viem/accounts';
const account = toAccount(cdpServerAccount);

// AWS/GCP KMS via viem adapters
const account = await createKmsAccount({ ... });
```

### Solana

The SDK accepts any `KeyPairSigner` from `@solana/kit`:

```typescript
// Generate new keypair
import { generateKeyPairSigner } from '@solana/kit';
const signer = await generateKeyPairSigner();

// Load from secret key bytes
import { createKeyPairSignerFromBytes } from '@solana/kit';
const signer = await createKeyPairSignerFromBytes(secretKeyBytes);
```

## API

### Constructor

```typescript
// EVM
new DtelecomGateway({ account: LocalAccount, gatewayUrl?: string })

// Solana
new DtelecomGateway({ solanaAccount: SolanaSigner, gatewayUrl?: string })
```

Exactly one of `account` or `solanaAccount` must be provided. `gatewayUrl` defaults to `https://x402.dtelecom.org`.

### Credits

| Method | Description |
|--------|-------------|
| `buyCredits({ amountUsd })` | Purchase credits via x402 USDC payment (Base or Solana) |

### Account

| Method | Description |
|--------|-------------|
| `getAccount()` | Get account details and balance |
| `getTransactions({ limit?, offset? })` | List credit transactions |
| `getSessions({ limit?, offset?, status? })` | List sessions |

### Agent Session (WebRTC + STT + TTS bundle)

For a speech session's `serverUrl`, use `toSpeechWebSocketUrl(serverUrl)` to connect to `/v1/stream`, and send the returned session token as `session_key` in the first message. The helper accepts HTTP/WebSocket schemes and avoids adding the path twice.

| Method | Description |
|--------|-------------|
| `createAgentSession({ roomName, participantIdentity, durationMinutes, language?, ttsMaxCharacters?, metadata?, clientIdentity?, clientIp? })` | Create bundled session |
| `extendAgentSession({ bundleId, additionalMinutes, additionalTtsCharacters? })` | Extend all sessions in bundle |

`createAgentSession` returns two WebRTC tokens — one for the agent and one for the client:

```typescript
{
  bundleId: string;
  webrtc: {
    agent:  { sessionId: string; token: string; wsUrl: string };
    client: { sessionId: string; token: string; wsUrl: string };
  };
  stt: { sessionId: string; token: string; serverUrl: string };
  tts: { sessionId: string; token: string; serverUrl: string };
  expiresAt: string;
}
```

### Standalone Sessions

| Method | Description |
|--------|-------------|
| `createWebRTCToken({ roomName, participantIdentity, durationMinutes, metadata? })` | Create WebRTC session |
| `extendWebRTCToken({ sessionId, additionalMinutes })` | Extend WebRTC session |
| `createSTTSession({ durationMinutes, language? })` | Create STT session |
| `extendSTTSession({ sessionId, additionalMinutes })` | Extend STT session |
| `createTTSSession({ maxCharacters, language? })` | Create TTS session |
| `extendTTSSession({ sessionId, additionalCharacters })` | Extend TTS session |

### Error Handling

```typescript
import {
  GatewayError,              // Base error (any non-2xx)
  InsufficientCreditsError,  // 402 — not enough credits
  ConcurrencyLimitError,     // 429 — too many active sessions
  RateLimitError,            // 429 — too many requests
  NoCapacityError,           // 503 — no servers available
  PaymentError,              // x402 payment failed
} from '@dtelecom/x402-client';

try {
  await gateway.createAgentSession({ ... });
} catch (err) {
  if (err instanceof InsufficientCreditsError) {
    await gateway.buyCredits({ amountUsd: 1.00 });
  }
}
```

## Pricing

| Service | Rate | Unit |
|---------|------|------|
| WebRTC | $0.001 | per audio participant minute |
| Streaming STT | $0.004 | per connected STT session minute |
| TTS | $0.006 | per 1K characters |
| Translation | $5 | per 1M input Unicode code points |
| File transcription + diarization | $0.003 | per decoded audio minute; 50 microcredits per started second |
| Text/SSML to WAV | $0.006 | per 1K expanded spoken Unicode code points |
| Vision snapshot | $0.002 | per completed snapshot |
| Audio moderation | $0.004 | per submitted audio minute |
| Image/frame moderation | $0.0005 | per completed frame |

1 USD = 1,000,000 microcredits. Two audio participants + one live STT session + 500 spoken TTS characters/minute cost $0.009/minute, excluding the LLM. Smart Turn, partials, SSML and optional watermark do not add a price multiplier. Check [live pricing](https://x402.dtelecom.org/v1/pricing) for enabled services. The SDK buys USDC credits on Base/Solana; other gateway payment rails require their own integrations.

## Text translation

`translate({ q, target, source?, idempotencyKey })` is available on the production gateway. The source defaults to `auto`. `getTranslation(id)` polls or retrieves the persisted result without another charge.

```typescript
import { randomUUID } from 'node:crypto';

const request = await gateway.translate({
  q: 'Hello, how are you?', target: 'es', idempotencyKey: randomUUID(),
});
if (request.status === 'completed') {
  console.log(request.result!.translatedText);
} else if (request.status === 'running') {
  // Poll after a delay; do not create a new request or buy credits automatically.
  const current = await gateway.getTranslation(request.id);
  console.log(current.status, current.result?.translatedText, current.error);
} else {
  console.error(request.error);
}
```

Billing: 5 microcredits per Unicode code point ($5 per million characters), charged only on success. The request limit is 500 code points. Truncated output is rejected without charge. `result.usage.outputTokens` is optional; billing uses `result.usage.characters`. Reuse the same idempotency key and input after an uncertain response. No automatic retries or credit purchases occur. TranslateGemma 4B + Hy-MT2 1.8B cover 45 language/script entries. A pair must share an enabled model; no pivot is performed (fa→en works, fa→sv does not). Hy-MT2 excludes es/ja/nl (Gemma retains them) and bo/mn/ug. Use explicit zh, zh-Hant or yue for Chinese script/variety; fil aliases tl. See the [route table](https://x402.dtelecom.org/docs.md#expanded-translation-routes). Dense input can still exceed token bounds (413).

## Speech streaming and partial transcripts

The SDK creates sessions and exports typed wire messages; your WebSocket implementation sends and receives audio. Connect to `toSpeechWebSocketUrl(session.serverUrl)`, send the config, wait for `ready`, then send raw mono 16 kHz PCM16 little-endian audio.

```typescript
import {
  toSpeechWebSocketUrl, type STTStreamConfig, type STTStreamReady,
  type STTTranscriptEvent,
} from '@dtelecom/x402-client';

const session = await gateway.createSTTSession({ durationMinutes: 5, language: 'en' });
const socket = new WebSocket(toSpeechWebSocketUrl(session.serverUrl));
const config: STTStreamConfig = {
  type: 'config', session_key: session.token, language: 'en', partials: true,
};
socket.addEventListener('open', () => socket.send(JSON.stringify(config)));
socket.addEventListener('message', ({ data }) => {
  const event = JSON.parse(String(data)) as STTStreamReady | STTTranscriptEvent;
  switch (event.type) {
    case 'ready':
      // Start sending PCM here. Handle error/session-expiry messages in your app too.
      break;
    case 'transcription_partial':
      // Replace the provisional window for this utterance; never append as final text.
      console.log(event.utterance_id, event.revision, event.window_start_seconds, event.text);
      break;
    case 'partial_end':
      // Clear the provisional window, including when reason is "finalizing".
      console.log(event.utterance_id, event.reason);
      break;
    case 'transcription':
      // Commit this authoritative final; it supersedes the provisional window.
      console.log(event.utterance_id, event.text);
      break;
  }
});
```

Partials are off by default. A partial is a replaceable recognition window, not a cumulative full-utterance transcript. Final-only clients retain the legacy message shape. Reconfiguration can end a provisional window with `reason: "reconfigured"`.

### Smart Turn (explicit opt-in)

Set `smart_turn: true` in `STTStreamConfig` to request semantic endpointing independently of partials. It needs the server's Smart Turn model and a supported ANE VAD language route. Inspect `ready.smart_turn`: `active` confirms the semantic hook; `acoustic_fallback` means ordinary silence detection. An absent field is not confirmation; a missing server model returns a configuration error.

Smart Turn can preserve pauses inside a thought. Current server defaults are threshold 0.5, minimum pause 500 ms, maximum 2,000 ms of received silence and a 250 ms classifier deadline. These are not microphone-to-final latency guarantees. Continuous PCM silence is required; WebRTC consumers should use server-sdk-node 0.2.6 or later for DTX/stalled-input silence reconstruction. Earlier 21 October diagnostic results predate these fixes. See the [current speech contract](https://x402.dtelecom.org/docs.md#streaming-speech-controls).

## TTS engines and catalog

The selected production runtime offers Kokoro (54 voices, eight languages plus British English) and Supertonic (ten styles, 31 languages), covering 32 distinct languages together. Both use the same TTS rate. Keep existing Kokoro `voice`/`lang_code` requests, or explicitly select a model and language:

```typescript
import type { TTSStreamConfig, TTSStreamText } from '@dtelecom/x402-client';

const session = await gateway.createTTSSession({ maxCharacters: 1000, language: 'ru' });
const auth: TTSStreamConfig = {
  session_key: session.token,
  config: { model: 'supertonic', language: 'ru', voice: 'M5', speed: 1 },
};
const text: TTSStreamText = { text: 'Привет! Как дела?' };
// Send auth as the first JSON message on /v1/stream, then text.
// {"type":"capabilities"} retrieves the enabled catalog.
```

Supertonic styles: `F1`–`F5`, `M1`–`M5`. Languages: ar, bg, hr, cs, da, nl, en, et, fi, fr, de, el, hi, hu, id, it, ja, ko, lv, lt, pl, pt, ro, ru, sk, sl, es, sv, tr, uk, vi. Kokoro additionally covers Mandarin Chinese. Supported speed ranges: Kokoro 0.5–2.0; Supertonic 0.75–1.5. Use the server's capabilities response for valid model/voice/language combinations; invalid combinations are rejected. Selected-runtime voice blending is not supported.

Audio is mono 48 kHz PCM16 little-endian in 20 ms frames. `clear`/`cleared` supports interruption. Watermarking defaults off and is explicitly opt-in; see activation checks below.

## File, vision and moderation APIs

These APIs are enabled on the production gateway. They use prepaid credits and wallet authentication; no WebRTC room is required. The SDK owns neither capture nor sampling, and does not automatically fund, retry or poll.

| Methods | Purpose |
|---|---|
| `createFileTranscription`, `getFileTranscription`, `deleteFileTranscription` | Upload, poll, cancel/delete transcription with optional diarization |
| `createWav`, `getWav`, `downloadWav`, `deleteWav` | Text/SSML-to-WAV jobs and private downloads |
| `createVisionSnapshot`, `getVisionSnapshot` | Uploaded image + optional question |
| `moderateAudio`, `moderateVideoFrame`, `getModerationRequest` | Submitted PCM audio or image/frame moderation |
| `createModerationStream`, `ModerationStream.sendAudio`, `ModerationStream.sendVideoFrame` | Ticket-authenticated WebSocket moderation |
| `translate`, `getTranslation` | Translate and recover a stored result |

```ts
const job = await gateway.createFileTranscription({
  file: new Blob([audioBytes]), filename: 'meeting.wav',
  language: 'en', diarize: true, idempotencyKey: crypto.randomUUID(),
});
const state = await gateway.getFileTranscription(job.id); // poll after a delay if nonterminal
if (state.status === 'completed') console.log(state.result?.segments);

const snapshot = await gateway.createVisionSnapshot({
  image: new Blob([imageBytes], { type: 'image/jpeg' }),
  question: 'What is visible?', idempotencyKey: crypto.randomUUID(),
});
```

File uploads: ≤256 MiB, ≤2 hours decoded, explicit Whisper language (default en; no auto), diarization on by default. Speaker labels are anonymous and file-local, not person identity or guaranteed overlapping-speaker separation. Live partials/Smart Turn do not apply. Supported audio/video container families and decoder constraints are in the [API reference](https://x402.dtelecom.org/docs.md#file-transcription-and-diarization).

Vision and frame moderation: static JPEG/PNG/WebP ≤6 MiB and 4 million pixels. Vision questions ≤4,000 code points and answers bounded to 96 output tokens. Audio moderation: raw PCM16 little-endian mono 16 kHz, ≤30 seconds, with no WAV header. Clients sample video and choose any moderation actions. Verdicts are combined policy results; native scores are uncalibrated, and an error is never a pass. No public text-moderation or full-video upload endpoint is provided.

Use [runnable inference examples](https://github.com/dTelecom/x402-client/tree/main/examples/inference) for HTTP, WebSocket and polling. The socket allows one in-flight item, uses a 10-minute ticket, and shares idempotency with HTTP. Disconnect does not cancel accepted work.

### Retry, retention and cleanup

Reuse the original key after an uncertain reply. File transcription returns the original job without comparing a repeated upload: use a new key for new media/options. WAV compares JSON; vision/moderation/translation compare their inputs, returning 409 on changed input. File/WAV keys allow printable ASCII without spaces; other inference keys allow letters/digits/underscore/hyphen; all are 1–128 characters. Replaying a failed key returns its failure; reconcile before submitting a new attempt.

Poll accepted IDs until terminal. Respect 429/Retry-After. Results/artifacts are private to the wallet and retained for 24 hours. Completed work is charged once; deleting it does not refund it. Pending cancellation can race with completion. Completed deleted file/WAV jobs return 404; failed/cancelled jobs can retain status-only tombstones after deletion. Expired vision/moderation/translation results return 410. Failed/cancelled batch jobs release reservations.

### Optional complete-request SSML

The `TTSStreamText` type (0.4.0+) accepts `input_format: "ssml"`, an optional
`request_id`, and a pronunciation `dictionary`. Send a complete `<speak>` document
on the existing TTS WebSocket. First request `{"type":"capabilities"}` and require
`ssml_profiles` to include `dtelecom-ssml-v1`; the types alone do not enable an older
or unconfigured server. Plain text remains the default. The server validates the
whole document and meters expanded spoken Unicode characters, excluding tags and
breaks. Text-to-WAV is available below; incremental XML streaming is not supported.

The [public SSML contract](https://x402.dtelecom.org/docs.md#ssml-dtelecom-ssml-v1) documents speak/p/s, timed break, sub alias, say-as characters (en/ar), prosody rate/volume, lang, voice and pronunciation dictionaries. Keep one engine per document. Effective SSML speed is 0.75–1.5; volume −12 to +6 dB; individual breaks ≤5 s, summed breaks ≤30 s, rounded to 20 ms frames. Source/expanded text ≤64 KiB, depth ≤16, nodes ≤2,048, rendered output ≤60 s. WAV jobs additionally cap source/expanded text at 10,000 code points. No marks, pitch, external audio or cross-engine switching.

```ts
const bilingual: TTSStreamText = {
  text: '<speak>Hello!<lang xml:lang="ru">Привет!</lang></speak>',
  input_format: 'ssml', voice: 'M5', language: 'en',
};
// Send the complete document after authenticating and negotiating capabilities.
```

### Optional TTS watermark (0.5.0+)

Watermarking is a separate explicit opt-in, like STT Smart Turn. It defaults off.
The gateway session API is unchanged; request the feature on the TTS WebSocket:

```ts
import type { TTSStreamText } from '@dtelecom/x402-client';

// After authenticating: request { type: 'capabilities' } and wait for the reply.
// Only proceed when capabilities.watermark === true.
const marked: TTSStreamText = { text: 'Hello!', watermark: true };
ws.send(JSON.stringify(marked));
// Require generating.watermark === 'active' before consuming binary PCM.
```

`TTSStreamConfig.config.watermark` can set a connection default; each text can
override it. Omitted/false keeps the existing unmarked path. The field also
works with `input_format: 'ssml'`. Server availability never automatically
opts a client in. Unsupported requests fail rather than silently dropping the
watermark. Older servers can ignore unknown fields, so both capability and
activation checks are necessary. This package exports the wire types; your
application owns the WebSocket and these checks. The agents-js TTS provider
performs the checks automatically when its `watermark: true` option is used.

The configuration is AudioSeal B: 48 kHz streaming, alpha 0.25, approximately
80 ms buffering plus 5 ms inference in the M6 lab. It runs after resampling and
SSML gain and before PCM16. There is no post-watermark audio cleanup. Detection
uses the matching 48 kHz profile; tiny/interrupted clips may not be detectable.

## Batch WAV jobs

These methods are available on the production gateway. Self-hosted gateways must enable `TTS_WAV_ENABLED` and configure a batch worker.

```ts
const job = await gateway.createWav({
  idempotencyKey: crypto.randomUUID(),
  text: '<speak>Hello!<break time="200ms"/>How are you?</speak>',
  inputFormat: "ssml",
  voice: "M5",
  language: "en", // use "ru" with Russian text
  speed: 1.1,
  // watermark: true, // explicit opt-in, only on capable servers
});

const state = await gateway.getWav(job.id); // poll at an appropriate interval
if (state.status === "completed") {
  const response = await gateway.downloadWav(job.id);
  const blob = await response.blob(); // or stream response.body directly to a file
  // state.result has sample rate, sample count, byte length and SHA-256.
}
// await gateway.deleteWav(job.id); // cancel unfinished work or delete artifact
```

The result is a complete 48 kHz mono PCM16 WAV. Inputs support the same voice,
language, speed and SSML/dictionary controls as streaming speech. Watermark stays
off unless explicitly requested. The gateway limits text and expanded spoken text
to 10,000 code points, JSON to 64 KiB and output to 30 minutes. A separate 60-second rendering limit applies per SSML document. WAV accepts voice/language, but not the streaming model/lang_code fields. Artifacts expire
after 24 hours and only the owning wallet can download them.

POST retries reuse the same key and identical input; changing input with an
existing WAV key gives 409. A failed/busy job needs a new key for a new attempt.
No method retries inference or buys credits automatically. Polling, downloads and
deleting completed artifacts do not add charges; deletion does not refund completed
work. Cancellation/failure before completion releases reserved credits.

File transcription continues to use `createFileTranscription`,
`getFileTranscription`, and `deleteFileTranscription`. Its batch implementation
uses resident Whisper with optional diarization; it does not require a WebRTC room.


## License

MIT
