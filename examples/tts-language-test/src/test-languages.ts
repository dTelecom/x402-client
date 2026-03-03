import { DtelecomGateway } from "@dtelecom/x402-client";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { WebSocket } from "ws";
import * as fs from "node:fs";
import * as path from "node:path";

const GATEWAY_URL = "https://x402.dtelecom.org";

// TTS languages: lang_code, voice, STT language code, test phrase
const LANGUAGES = [
  { name: "English (US)", langCode: "a", voice: "af_heart", sttLang: "en", phrase: "The quick brown fox jumps over the lazy dog" },
  { name: "English (UK)", langCode: "b", voice: "bf_emma", sttLang: "en", phrase: "The quick brown fox jumps over the lazy dog" },
  { name: "Spanish", langCode: "e", voice: "ef_dora", sttLang: "es", phrase: "El rápido zorro marrón salta sobre el perro perezoso" },
  { name: "French", langCode: "f", voice: "ff_siwis", sttLang: "fr", phrase: "Le renard brun rapide saute par-dessus le chien paresseux" },
  { name: "Hindi", langCode: "h", voice: "hf_alpha", sttLang: "hi", phrase: "तेज भूरी लोमड़ी आलसी कुत्ते के ऊपर कूदती है" },
  { name: "Italian", langCode: "i", voice: "if_sara", sttLang: "it", phrase: "La veloce volpe marrone salta sopra il cane pigro" },
  { name: "Japanese", langCode: "j", voice: "jf_alpha", sttLang: "ja", phrase: "素早い茶色の狐が怠惰な犬を飛び越える" },
  { name: "Portuguese (BR)", langCode: "p", voice: "pf_dora", sttLang: "pt", phrase: "A rápida raposa marrom pula sobre o cachorro preguiçoso" },
  { name: "Chinese (Mandarin)", langCode: "z", voice: "zf_xiaobei", sttLang: "zh", phrase: "敏捷的棕色狐狸跳过了懒狗" },
];

// Downsample PCM16 from 48kHz to 16kHz (factor of 3)
function downsample48to16(pcm48: Buffer): Buffer {
  const samples48 = new Int16Array(pcm48.buffer, pcm48.byteOffset, pcm48.byteLength / 2);
  const outLen = Math.floor(samples48.length / 3);
  const samples16 = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    samples16[i] = samples48[i * 3];
  }
  return Buffer.from(samples16.buffer);
}

// Connect to TTS WebSocket, send text, collect all PCM16 audio
function synthesize(
  serverUrl: string,
  token: string,
  text: string,
  voice: string,
  langCode: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const wsUrl = serverUrl.replace("https://", "wss://").replace("http://", "ws://");
    const ws = new WebSocket(`${wsUrl}/v1/stream`);
    const chunks: Buffer[] = [];
    let configSent = false;

    ws.on("open", () => {
      ws.send(JSON.stringify({
        session_key: token,
        config: { voice, lang_code: langCode, speed: 1.0 },
      }));
      configSent = true;
      ws.send(JSON.stringify({ text }));
    });

    ws.on("message", (data: Buffer | string) => {
      if (typeof data === "string" || (data instanceof Buffer && data[0] === 0x7b)) {
        // JSON message
        const str = typeof data === "string" ? data : data.toString("utf-8");
        try {
          const msg = JSON.parse(str);
          if (msg.type === "done") {
            ws.close();
          } else if (msg.type === "error") {
            reject(new Error(`TTS error: ${msg.message}`));
            ws.close();
          }
        } catch {
          // not JSON, treat as binary
          chunks.push(Buffer.from(data as Buffer));
        }
      } else {
        // Binary PCM16 audio chunk
        chunks.push(Buffer.from(data as Buffer));
      }
    });

    ws.on("close", () => {
      resolve(Buffer.concat(chunks));
    });

    ws.on("error", (err) => {
      reject(new Error(`TTS WebSocket error: ${err.message}`));
    });

    // Timeout after 30s
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
        reject(new Error("TTS timeout"));
      }
    }, 30_000);
  });
}

// Connect to STT WebSocket, send audio, wait for transcription
function transcribe(
  serverUrl: string,
  token: string,
  pcm16at16k: Buffer,
  language: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const wsUrl = serverUrl.replace("https://", "wss://").replace("http://", "ws://");
    const ws = new WebSocket(`${wsUrl}/v1/stream`);
    let transcript = "";
    let resolved = false;
    let audioSent = false;

    const done = () => {
      if (!resolved) {
        resolved = true;
        ws.close();
        resolve(transcript);
      }
    };

    ws.on("open", () => {
      // Send config
      ws.send(JSON.stringify({
        type: "config",
        language,
        session_key: token,
      }));

      // Send audio in 100ms chunks (16kHz * 2 bytes * 0.1s = 3200 bytes)
      const chunkSize = 3200;
      let offset = 0;
      const sendNext = () => {
        if (offset >= pcm16at16k.length) {
          // Append 1s of silence so VAD detects speech_end
          const silence = Buffer.alloc(16000 * 2); // 1s at 16kHz, 16-bit
          ws.send(silence);
          setTimeout(() => {
            ws.send(JSON.stringify({ type: "flush" }));
            audioSent = true;
          }, 100);
          return;
        }
        const end = Math.min(offset + chunkSize, pcm16at16k.length);
        ws.send(pcm16at16k.subarray(offset, end));
        offset = end;
        setTimeout(sendNext, 50);
      };
      sendNext();
    });

    ws.on("message", (data: Buffer | string) => {
      const str = typeof data === "string" ? data : data.toString("utf-8");
      try {
        const msg = JSON.parse(str);
        if (msg.type === "transcription") {
          if (msg.is_final) {
            transcript += (transcript ? " " : "") + msg.text;
            // Got final transcription after audio was sent — we're done
            if (audioSent) {
              setTimeout(done, 2000); // wait a bit for any more finals
            }
          }
        } else if (msg.type === "error") {
          console.error(`    STT msg: ${str}`);
        }
      } catch {
        // ignore non-JSON
      }
    });

    ws.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        reject(new Error(`STT WebSocket error: ${err.message}`));
      }
    });

    ws.on("close", () => {
      if (!resolved) {
        resolved = true;
        resolve(transcript);
      }
    });

    // Hard timeout
    setTimeout(done, 20_000);
  });
}

// Similarity: word overlap for spaced languages, character overlap for CJK
function similarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length === 0 && nb.length === 0) return 1;
  if (na.length === 0 || nb.length === 0) return 0;

  // Use character-level for CJK (no spaces between words)
  const isCJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(na);
  if (isCJK) {
    const charsA = [...na.replace(/\s/g, "")];
    const charsB = [...nb.replace(/\s/g, "")];
    const setB = new Set(charsB);
    let overlap = 0;
    for (const c of charsA) {
      if (setB.has(c)) overlap++;
    }
    return overlap / Math.max(charsA.length, charsB.length);
  }

  // Word-level for spaced languages
  const wordsA = new Set(na.split(/\s+/).filter(Boolean));
  const wordsB = new Set(nb.split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

async function main() {
  // Load or generate wallet
  const keyFile = path.join(import.meta.dirname, ".wallet-key");
  let privateKey: `0x${string}`;

  if (fs.existsSync(keyFile)) {
    privateKey = fs.readFileSync(keyFile, "utf-8").trim() as `0x${string}`;
  } else {
    privateKey = generatePrivateKey();
    fs.writeFileSync(keyFile, privateKey, "utf-8");
  }

  const account = privateKeyToAccount(privateKey);
  console.log(`Wallet: ${account.address}\n`);

  const gateway = new DtelecomGateway({
    gatewayUrl: GATEWAY_URL,
    account,
  });

  // Check balance
  let acct;
  try {
    acct = await gateway.getAccount();
    console.log(`Balance: ${acct.creditBalance} microcredits (available: ${acct.availableBalance})\n`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Account not found")) {
      console.log("Account not found — need to buy credits first.");
      console.log(`Fund this wallet with 0.1 USDC on Base: ${account.address}`);
      console.log("Then run: npm run buy-credits\n");
      return;
    }
    throw err;
  }

  // Create output dir for audio files
  const outDir = path.join(import.meta.dirname, "..", "output");
  fs.mkdirSync(outDir, { recursive: true });

  const results: { name: string; phrase: string; transcription: string; sim: number; pass: boolean }[] = [];

  for (const lang of LANGUAGES) {
    console.log(`--- ${lang.name} ---`);
    console.log(`  Phrase: "${lang.phrase}"`);

    try {
      // Create TTS session
      const tts = await gateway.createTTSSession({
        maxCharacters: 1000,
        language: lang.sttLang,
      });
      console.log(`  TTS session: ${tts.sessionId.slice(0, 8)}... → ${tts.serverUrl}`);

      // Create STT session
      const stt = await gateway.createSTTSession({
        durationMinutes: 2,
        language: lang.sttLang,
      });
      console.log(`  STT session: ${stt.sessionId.slice(0, 8)}... → ${stt.serverUrl}`);

      // Synthesize
      console.log("  Synthesizing...");
      const audio48k = await synthesize(tts.serverUrl, tts.token, lang.phrase, lang.voice, lang.langCode);
      const durationSec = (audio48k.length / 2) / 48000;
      console.log(`  Got ${audio48k.length} bytes (${durationSec.toFixed(1)}s at 48kHz)`);

      // Save audio
      fs.writeFileSync(path.join(outDir, `${lang.sttLang}-48k.pcm`), audio48k);

      // Downsample 48kHz → 16kHz
      const audio16k = downsample48to16(audio48k);
      fs.writeFileSync(path.join(outDir, `${lang.sttLang}-16k.pcm`), audio16k);
      console.log(`  Downsampled to ${audio16k.length} bytes (16kHz)`);

      // Transcribe
      console.log("  Transcribing...");
      const transcription = await transcribe(stt.serverUrl, stt.token, audio16k, lang.sttLang);
      console.log(`  Result: "${transcription}"`);

      const sim = similarity(lang.phrase, transcription);
      const pass = transcription.length > 0;
      results.push({ name: lang.name, phrase: lang.phrase, transcription, sim, pass });
      console.log(`  Similarity: ${(sim * 100).toFixed(0)}% ${pass ? "PASS" : "FAIL"}\n`);
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}\n`);
      results.push({ name: lang.name, phrase: lang.phrase, transcription: "", sim: 0, pass: false });
    }
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  console.log(`${"Language".padEnd(22)} ${"Sim".padStart(5)}  Result`);
  console.log("-".repeat(45));
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    console.log(`${r.name.padEnd(22)} ${(r.sim * 100).toFixed(0).padStart(4)}%  ${status}`);
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} languages produced transcription`);
}

main().catch(console.error);
