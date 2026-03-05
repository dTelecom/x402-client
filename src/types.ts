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
