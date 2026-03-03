# @dtelecom/x402-client

TypeScript SDK for the [dTelecom x402 gateway](https://x402.dtelecom.org) — buy credits with USDC and create WebRTC, STT, and TTS sessions for AI agents.

Uses the [x402 HTTP payment protocol](https://www.x402.org/) for on-chain micropayments on Base.

## Install

```bash
npm install @dtelecom/x402-client @x402/fetch @x402/evm viem
```

`@x402/fetch` and `@x402/evm` are peer dependencies — they handle the 402 payment flow.

## Quick Start

```typescript
import { DtelecomGateway } from '@dtelecom/x402-client';
import { privateKeyToAccount } from 'viem/accounts';

const gateway = new DtelecomGateway({
  gatewayUrl: 'https://x402.dtelecom.org',
  account: privateKeyToAccount(process.env.WALLET_PRIVATE_KEY as `0x${string}`),
});

// Buy credits ($0.10 USDC on Base)
const purchase = await gateway.buyCredits({ amountUsd: 0.10 });
console.log(`Credits: ${purchase.creditedMicrocredits}`);

// Create agent session (WebRTC + STT + TTS bundle)
const session = await gateway.createAgentSession({
  roomName: 'tutor-room-123',
  participantIdentity: 'student-1',
  durationMinutes: 10,
  language: 'en',
});

console.log(session.webrtc.token);  // JWT for WebRTC SFU
console.log(session.stt.token);     // Token for STT server
console.log(session.tts.token);     // Token for TTS server
```

## Wallet Support

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

## API

### Constructor

```typescript
new DtelecomGateway({ gatewayUrl: string, account: LocalAccount })
```

### Credits

| Method | Description |
|--------|-------------|
| `buyCredits({ amountUsd })` | Purchase credits via x402 USDC payment on Base |

### Account

| Method | Description |
|--------|-------------|
| `getAccount()` | Get account details and balance |
| `getTransactions({ limit?, offset? })` | List credit transactions |
| `getSessions({ limit?, offset?, status? })` | List sessions |

### Agent Session (WebRTC + STT + TTS bundle)

| Method | Description |
|--------|-------------|
| `createAgentSession({ roomName, participantIdentity, durationMinutes, language?, ttsMaxCharacters?, metadata? })` | Create bundled session |
| `extendAgentSession({ bundleId, additionalMinutes, additionalTtsCharacters? })` | Extend all sessions in bundle |

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
| STT | $0.006 | per minute |
| TTS | $0.008 | per 1K characters |

1 USD = 1,000,000 microcredits.

## License

MIT
