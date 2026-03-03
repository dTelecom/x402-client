# TTS Language Test

End-to-end test for all supported TTS languages. For each language, it:

1. Creates a TTS session and synthesizes a test phrase
2. Downsamples audio from 48kHz to 16kHz
3. Creates an STT session and transcribes the audio back to text
4. Compares the transcription with the original phrase

## Supported Languages

| Language | TTS Code | Voice | STT Code |
|----------|----------|-------|----------|
| English (US) | `a` | `af_heart` | `en` |
| English (UK) | `b` | `bf_emma` | `en` |
| Spanish | `e` | `ef_dora` | `es` |
| French | `f` | `ff_siwis` | `fr` |
| Hindi | `h` | `hf_alpha` | `hi` |
| Italian | `i` | `if_sara` | `it` |
| Japanese | `j` | `jf_alpha` | `ja` |
| Portuguese (BR) | `p` | `pf_dora` | `pt` |
| Chinese (Mandarin) | `z` | `zf_xiaobei` | `zh` |

## Setup

```bash
npm install
```

## Usage

First run generates a wallet. Fund it with USDC on Base, then buy credits:

```bash
# Run once to generate wallet — note the address printed
npm test

# Fund the wallet with >= 0.10 USDC on Base
# Then buy credits:
npm run buy-credits

# Run the language test
npm test
```

## Output

Audio files (PCM16) are saved to `output/` for debugging:
- `{lang}-48k.pcm` — raw TTS output at 48kHz
- `{lang}-16k.pcm` — downsampled to 16kHz for STT
