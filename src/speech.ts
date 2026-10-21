/** Convert a gateway speech server URL to its authenticated WebSocket endpoint. */
export function toSpeechWebSocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("Speech servers require an HTTP or WebSocket URL");
  if (url.pathname !== "/" && url.pathname !== "/v1/stream") throw new Error("Unexpected speech server path");
  url.pathname = "/v1/stream";
  url.hash = "";
  return url.toString();
}

// Wire message names intentionally match the speech server JSON contract.
// Optional candidate controls require the corresponding upgraded speech server.
export interface STTStreamConfig {
  type: "config";
  session_key?: string;
  language?: string;
  model?: "whisper";
  partials?: boolean;
  smart_turn?: boolean;
}

export interface STTFinalTranscript {
  type: "transcription";
  text: string;
  language: string;
  is_final: true;
  latency_ms: number;
  timestamp: number;
  /** Present when interim results are enabled; replaces provisional window text. */
  utterance_id?: string;
}

export interface STTPartialTranscript {
  type: "transcription_partial";
  text: string;
  language: string;
  is_final: false;
  provisional: true;
  replace_previous: true;
  utterance_id: string;
  revision: number;
  window_start_seconds: number;
}

export interface STTPartialEnd {
  type: "partial_end";
  utterance_id: string;
  reason: "finalizing" | "discarded" | "replaced" | "reconfigured";
}

export interface SpeechStreamExtension {
  type: "extend";
  session_key: string;
}

export interface TTSVoiceOptions {
  model?: "kokoro" | "supertonic";
  language?: string;
  voice?: string;
  lang_code?: string;
  speed?: number;
}

export interface TTSStreamConfig {
  session_key?: string;
  config?: TTSVoiceOptions;
}

export interface TTSStreamText extends TTSVoiceOptions {
  text: string;
}
