# Inference client examples

Run with Node 22 after `npm run build` in `x402-client`. These examples send supplied data and print responses. Your application owns capture, segmentation, sampling and rooms. Nothing purchases credits automatically. Set origins explicitly; there is no production URL default. Use a disposable test wallet and local gateway for rehearsal. For funded production calls set GATEWAY_ORIGIN=https://x402.dtelecom.org.

Operator-only loopback HTTP for vision/moderation, without public billing (file/WAV backends require gateway signatures and are not covered by this direct example):

```sh
DIRECT_ORIGIN=http://127.0.0.1:8770 SERVICE=text INPUT_FILE=message.txt node examples/inference/direct.mjs
DIRECT_ORIGIN=http://127.0.0.1:8770 SERVICE=image INPUT_FILE=frame.jpg node examples/inference/direct.mjs
DIRECT_ORIGIN=http://127.0.0.1:8771 SERVICE=vision INPUT_FILE=frame.jpg QUESTION='What is visible?' node examples/inference/direct.mjs
DIRECT_ORIGIN=http://127.0.0.1:8770 SERVICE=audio INPUT_FILE=speech.pcm node examples/inference/direct.mjs
```

Direct live moderation: set `TRANSPORT=ws`, `SERVICE=audio` or `SERVICE=video`. `/moderate/stream` sends readiness immediately; send no auth frame. Each request is JSON metadata followed by one binary chunk/frame, then wait for its result. Direct request IDs correlate replies; they do not promise durable exactly-once inference across reconnects.

Paid HTTP:

```sh
export GATEWAY_ORIGIN=http://127.0.0.1:3499
# Set WALLET_PRIVATE_KEY using your existing secret handling, and fund the test account separately.
SERVICE=vision INPUT_FILE=frame.jpg IDEMPOTENCY_KEY=frame-0001 node examples/inference/paid.mjs
SERVICE=audio INPUT_FILE=speech.pcm IDEMPOTENCY_KEY=audio-0001 node examples/inference/paid.mjs
SERVICE=file INPUT_FILE=meeting.wav IDEMPOTENCY_KEY=meeting-0001 node examples/inference/paid.mjs
```

For paid WebSockets add `TRANSPORT=ws` and use `SERVICE=audio|video`. The SDK obtains a wallet-authenticated ticket, sends its token as the first frame, and awaits readiness. Tokens expire; obtain a fresh ticket after reconnecting. Reuse the **same idempotency key, media bytes, service and options** after an uncertain paid reply. A changed vision/moderation payload under an existing key conflicts (409). File transcription instead returns the original job without rereading a repeated upload; new media/options require a new key. HTTP and WebSocket retries share the same durable result. Use `REQUEST_ID` to retrieve/poll a known paid result. Never invent a new key merely because a response was lost.

The examples make no automatic upload retry. They poll returned in-flight IDs, show 402 as a funding action, and report 429/503/504 with backoff/retrieval guidance. Invalid input (413/415/422) must be corrected; authentication/expiry requires a new valid credential. A transport error is not evidence that inference or charging failed. A moderation `pass` only applies to its versioned combined policy; read `evaluated_categories`, and distinguish successful verdicts from service errors. Clients decide actions.

Audio moderation accepts **raw mono 16,000 Hz signed PCM16 little-endian**, up to 30 seconds per chunk. Compressed media or a WAV header must not be sent as PCM. Convert externally:

```sh
ffmpeg -i input.wav -ac 1 -ar 16000 -c:a pcm_s16le -f s16le speech.pcm
```

Alternatively use `AUDIO_FORMAT=wav` for an already PCM16/mono/16kHz WAV; the example validates and strips its container. `audio.mjs` also converts already resampled mono Float32 samples with documented clipping and rejects NaN/Infinity. It does not resample or decode arbitrary audio. Keep coherent speech context; silence/unclassifiable speech produces an error, never a safe verdict.

File transcription accepts an audio/video file through its separate file API, not the raw-PCM moderation endpoint. Use `SERVICE=file` with the paid gateway example; it polls with diarization enabled. The signed file backend is not a public direct-upload API. Images are static JPEG/PNG/WebP, at most 6 MiB/4 megapixels. Live video means your application samples and submits frames; these examples do not capture or join a room.

Formatting checks: `node --test examples/inference/check-audio.mjs`. Current contract and rollout limits: [public API contract](https://x402.dtelecom.org/docs.md).

Text/SSML-to-WAV uses `createWav`, `getWav`, `downloadWav` and `deleteWav`; see the [SDK example](https://github.com/dTelecom/x402-client#batch-wav-jobs).
