# @dtelecom/x402-client

TypeScript SDK for the [dTelecom x402 gateway](https://x402.dtelecom.org) — buy credits with USDC and create WebRTC, STT, and TTS sessions and translate text for AI agents.

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
| WebRTC | $0.001 | per minute |
| STT | $0.004 | per minute |
| TTS | $0.006 | per 1K characters |
| Translation | $5 | per 1M Unicode code points |

1 USD = 1,000,000 microcredits.

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

Billing: 5 microcredits per Unicode code point ($5 per million characters), charged only on success. The request limit is 500 code points. Truncated output is rejected without charge. `result.usage.outputTokens` is optional; billing uses `result.usage.characters`. Reuse the same idempotency key and input after an uncertain response. No automatic retries or credit purchases occur. TranslateGemma currently supports 32 languages; the planned Hy-MT2 expansion is not enabled.

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

Smart Turn can preserve pauses inside a thought, but can also delay a completed answer. In the 21 October M6 natural-speech diagnostic it prevented 10 of 13 premature internal splits, while seven of 14 examples finalized in roughly 2.1–2.3 seconds. These small diagnostic samples are not a general accuracy guarantee. It remains opt-in; enabling partials does not enable Smart Turn.

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

Audio is mono 48 kHz PCM16 little-endian in 20 ms frames. `clear`/`cleared` supports interruption. Watermarking is disabled and is not offered.

## Optional inference APIs (not enabled in production)

Version 0.3.0 also exports vision, moderation and file-transcription client methods for explicitly configured test deployments. Their presence in the SDK does not enable these services on the public gateway. Clients own capture, sampling and room logic; vision/moderation need no WebRTC session. No automatic retries or credit purchases occur. See the [inference examples](https://github.com/dTelecom/x402-client/tree/main/examples/inference) for request formats and polling.

## License

MIT

Runnable paid/direct HTTP and WebSocket examples, including PCM formatting and file polling: [inference examples](examples/inference/README.md).

### Optional complete-request SSML

The `TTSStreamText` type (0.4.0+) accepts `input_format: "ssml"`, an optional
`request_id`, and a pronunciation `dictionary`. Send a complete `<speak>` document
on the existing TTS WebSocket. First request `{"type":"capabilities"}` and require
`ssml_profiles` to include `dtelecom-ssml-v1`; the types alone do not enable an older
or unconfigured server. Plain text remains the default. The server validates the
whole document and meters expanded spoken Unicode characters, excluding tags and
breaks. Text-to-WAV and incremental XML streaming are separate, unshipped features.
