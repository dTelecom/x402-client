// === Solana signer interface (structurally compatible with @solana/kit KeyPairSigner) ===

export interface SolanaSigner {
  readonly address: string;
  signMessages(
    messages: readonly { content: Uint8Array }[],
  ): Promise<readonly Record<string, string>[]>;
}

// === Request types (camelCase — SDK convention) ===

export interface BuyCreditsRequest {
  amountUsd: number;
}

export interface CreateWebRTCTokenRequest {
  roomName: string;
  participantIdentity: string;
  durationMinutes: number;
  metadata?: string;
  clientIp?: string;
}

export interface ExtendWebRTCTokenRequest {
  sessionId: string;
  additionalMinutes: number;
}

export interface CreateSTTSessionRequest {
  durationMinutes: number;
  language?: string;
}

export interface ExtendSTTSessionRequest {
  sessionId: string;
  additionalMinutes: number;
}

export interface CreateTTSSessionRequest {
  maxCharacters: number;
  language?: string;
}

export interface ExtendTTSSessionRequest {
  sessionId: string;
  additionalCharacters: number;
}

export interface CreateAgentSessionRequest {
  roomName: string;
  participantIdentity: string;
  durationMinutes: number;
  language?: string;
  ttsMaxCharacters?: number;
  metadata?: string;
  clientIdentity?: string;
  clientIp?: string;
}

export interface ExtendAgentSessionRequest {
  bundleId: string;
  additionalMinutes: number;
  additionalTtsCharacters?: number;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface SessionsOptions extends PaginationOptions {
  status?: string;
}

// === Response types (camelCase — SDK maps from snake_case gateway responses) ===

export interface BuyCreditsResponse {
  accountId: string;
  creditedMicrocredits: string;
  amountUsd: number;
}

export interface AccountResponse {
  id: string;
  walletAddress: string;
  walletChain: string;
  creditBalance: string;
  availableBalance: string;
  maxConcurrentSessions: number;
  maxApiRate: number;
  createdAt: string;
}

export interface Transaction {
  id: string;
  amount: string;
  balanceAfter: string;
  type: string;
  referenceId: string | null;
  service: string | null;
  description: string | null;
  createdAt: string;
}

export interface TransactionsResponse {
  transactions: Transaction[];
  limit: number;
  offset: number;
}

export interface Session {
  id: string;
  service: string;
  bundleId: string | null;
  status: string;
  roomName: string | null;
  serverUrl: string | null;
  reservedMicrocredits: string;
  chargedMicrocredits: string;
  tokenExpiresAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  settlementMethod: string;
  createdAt: string;
}

export interface SessionsResponse {
  sessions: Session[];
  limit: number;
  offset: number;
}

export interface WebRTCTokenResponse {
  sessionId: string;
  token: string;
  wsUrl: string;
  expiresAt: string;
}

export interface ExtendWebRTCTokenResponse {
  token: string;
  wsUrl: string;
  newExpiresAt: string;
}

export interface STTSessionResponse {
  sessionId: string;
  token: string;
  serverUrl: string;
  expiresAt: string;
}

export interface ExtendSTTSessionResponse {
  token: string;
  newExpiresAt: string;
}

export interface TTSSessionResponse {
  sessionId: string;
  token: string;
  serverUrl: string;
  expiresAt: string;
}

export interface ExtendTTSSessionResponse {
  token: string;
  maxCharacters: number;
  newExpiresAt: string;
}

export interface AgentSessionResponse {
  bundleId: string;
  webrtc: {
    agent: { sessionId: string; token: string; wsUrl: string };
    client: { sessionId: string; token: string; wsUrl: string };
  };
  stt: { sessionId: string; token: string; serverUrl: string };
  tts: { sessionId: string; token: string; serverUrl: string };
  expiresAt: string;
}

export interface ExtendAgentSessionResponse {
  webrtc?: {
    agent?: { token: string; newExpiresAt: string };
    client?: { token: string; newExpiresAt: string };
  };
  stt?: { token: string; newExpiresAt: string };
  tts?: { token: string; newExpiresAt: string };
}


export interface CreateFileTranscriptionRequest {
  file: Blob;
  /** Reuse this key for retries of the same logical file submission. */
  idempotencyKey: string;
  filename?: string;
  language?: string;
  /** Speaker diarization is included and defaults to true. */
  diarize?: boolean;
}

export interface FileTranscriptionResult {
  text: string;
  language: string;
  segments: { start: number; end: number; speaker: string | null; text: string }[];
  media: { sample_count: number; sample_rate: 16000; channels: 1; duration_seconds: number };
  speaker_segments?: { start: number; end: number; speaker: string }[];
  speaker_labels?: string;
  timing_type: string;
}

export interface FileTranscriptionJob {
  id: string;
  status: "uploading" | "queued" | "running" | "completed" | "failed" | "cancelled" | "deleted";
  durationSeconds?: number;
  result?: FileTranscriptionResult;
  error?: string;
}

export interface CreateVisionSnapshotRequest {
  image: Blob;
  idempotencyKey: string;
  question?: string;
}
export interface VisionSnapshotResult {
  requestId: string;
  answer: string;
  model: string;
  generatedTokens: number;
  promptTokens: number;
  finishReason: string;
  outputTokenLimitReached: boolean;
  usage: { completedSnapshots: 1 };
}
export interface VisionSnapshot {
  id: string;
  status: "running" | "completed" | "failed";
  result?: VisionSnapshotResult;
  error?: string;
  chargedMicrocredits: string;
}
export interface ModerationResult {
  policy: "text_safety" | "visual_safety";
  policy_version: "content-screen-v2";
  /** Combined policy: these are evaluated categories, not independent category predictions. */
  evaluated_categories: ("sexual_content" | "nudity" | "violence" | "weapons" | "hate_symbols")[];
  decision: "pass" | "flag";
  evidence: { model: "Shieldstral"; yes_probability: number; calibrated: false; score_type: string };
  image_screening?: { model: "Freepik"; native_scores: Record<"neutral" | "low" | "medium" | "high", number>; calibrated: false };
  transcript?: string;
  language?: string;
  usage: { completed_frames: 1 } | { audio_samples: number; sample_rate: 16000 };
}
export interface ModerationInference {
  id: string;
  kind: "moderation-audio" | "moderation-video";
  status: "running" | "completed" | "failed";
  chargedMicrocredits: string;
  result?: ModerationResult;
  error?: string;
}
export interface TranslateRequest {
  /** Text to translate: 1–500 Unicode code points by default; billed per code point. */
  q: string;
  target: string;
  /** Defaults to "auto" on the gateway. */
  source?: string;
  idempotencyKey: string;
}
export interface TranslationResult {
  translatedText: string;
  source: string;
  target: string;
  detectedLanguage?: { language: string; confidence: number };
  /** `outputTokens` is reported by the model backend when available; billing uses `characters` only. */
  usage: { characters: number; outputTokens?: number };
}
export interface TranslationRequest {
  id: string;
  kind: "translation";
  status: "running" | "completed" | "failed";
  chargedMicrocredits: string;
  result?: TranslationResult;
  error?: string;
}
export interface ModerationStreamTicket {
  token: string;
  websocketUrl: string;
  expiresAt: string;
  protocol: "dtelecom.moderation.v1";
}
