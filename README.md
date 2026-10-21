# @dtelecom/x402-client

TypeScript SDK for the [dTelecom x402 gateway](https://x402.dtelecom.org) — buy credits with USDC and create WebRTC, STT, and TTS sessions for AI agents.

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

1 USD = 1,000,000 microcredits.

## Local inference candidate

`createVisionSnapshot({ image, question?, idempotencyKey })` uploads an image to our vision model. For live moderation, use `createModerationStream()` and `ModerationStream.connect(ticket)`, then send PCM audio chunks or sampled image frames and receive correlated results. `moderateAudio`, `moderateVideoFrame` and `getModerationRequest` provide HTTP alternatives. Clients own capture, sampling and rooms; no WebRTC session is required by these APIs. Direct internal services remain unauthenticated/unbilled. No automatic retries or credit purchases occur. See [the contract and limits](../tasks/inference-api/README.md). This local candidate is unpublished and disabled in production; earlier unpublished room-bound moderation methods have been superseded.

`translate({ q, target, source?, idempotencyKey })` translates text (source defaults to `auto`) and `getTranslation(id)` polls or retrieves a persisted result without another charge. Billing is 5 microcredits per Unicode code point of `q` ($5 per 1M characters), charged only on success; the default limit is 500 code points per request (sized so the densest measured script, Chinese, fits the backend's output budget). A translation the backend would truncate is rejected and not charged; `result.usage.outputTokens` reports model output tokens when available. No automatic retries or credit purchases occur. This local candidate is unpublished and disabled in production.

## License

MIT

Runnable paid/direct HTTP and WebSocket examples, including PCM formatting and file polling: [inference examples](examples/inference/README.md).
