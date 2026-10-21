import type { LocalAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";

import { createAuthHeaders, createSolanaAuthHeaders } from "./auth.js";
import {
  GatewayError,
  InsufficientCreditsError,
  ConcurrencyLimitError,
  RateLimitError,
  NoCapacityError,
  PaymentError,
} from "./errors.js";
import type {
  SolanaSigner,
  CreateFileTranscriptionRequest,
  FileTranscriptionJob,
  CreateVisionSnapshotRequest,
  VisionSnapshot,
  ModerationInference,
  ModerationStreamTicket,
  TranslateRequest,
  TranslationRequest,
  BuyCreditsRequest,
  BuyCreditsResponse,
  AccountResponse,
  TransactionsResponse,
  Transaction,
  SessionsResponse,
  Session,
  PaginationOptions,
  SessionsOptions,
  CreateWebRTCTokenRequest,
  WebRTCTokenResponse,
  ExtendWebRTCTokenRequest,
  ExtendWebRTCTokenResponse,
  CreateSTTSessionRequest,
  STTSessionResponse,
  ExtendSTTSessionRequest,
  ExtendSTTSessionResponse,
  CreateTTSSessionRequest,
  TTSSessionResponse,
  ExtendTTSSessionRequest,
  ExtendTTSSessionResponse,
  CreateAgentSessionRequest,
  AgentSessionResponse,
  ExtendAgentSessionRequest,
  ExtendAgentSessionResponse,
} from "./types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

export interface DtelecomGatewayConfig {
  /** Gateway base URL (default: "https://x402.dtelecom.org") */
  gatewayUrl?: string;
  /** viem LocalAccount — from privateKeyToAccount(), CDP toAccount(), KMS adapter, etc. */
  account?: LocalAccount;
  /** Solana signer — structurally compatible with @solana/kit KeyPairSigner */
  solanaAccount?: SolanaSigner;
}

export class DtelecomGateway {
  private readonly baseUrl: string;
  private readonly account?: LocalAccount;
  private readonly solanaAccount?: SolanaSigner;
  private readonly walletChain: "evm" | "solana";
  private readonly walletAddress: string;
  private readonly fetchWithPayment: typeof fetch;
  private readonly svmReady: Promise<void>;

  constructor(config: DtelecomGatewayConfig) {
    if (!config.account && !config.solanaAccount) {
      throw new Error("Either account (EVM) or solanaAccount (Solana) must be provided");
    }

    this.baseUrl = (config.gatewayUrl ?? "https://x402.dtelecom.org").replace(/\/+$/, "");
    this.account = config.account;
    this.solanaAccount = config.solanaAccount;

    const x402 = new x402Client();

    if (config.account) {
      this.walletChain = "evm";
      this.walletAddress = config.account.address;

      // Set up x402 payment client for EVM (Base mainnet)
      const publicClient = createPublicClient({ chain: base, transport: http() });
      const signer = toClientEvmSigner(config.account, publicClient);
      registerExactEvmScheme(x402, { signer });
      this.svmReady = Promise.resolve();
    } else {
      this.walletChain = "solana";
      this.walletAddress = config.solanaAccount!.address;

      // Dynamically load @x402/svm for Solana payment scheme
      // Cast: at runtime solanaAccount is a KeyPairSigner which satisfies TransactionSigner
      this.svmReady = import("@x402/svm/exact/client")
        .then(({ registerExactSvmScheme }) => {
          registerExactSvmScheme(x402, { signer: config.solanaAccount as never });
        })
        .catch(() => {
          throw new Error(
            "@x402/svm is required for Solana support. Install it: npm install @x402/svm @solana/kit",
          );
        });
    }

    this.fetchWithPayment = wrapFetchWithPayment(fetch, x402);
  }

  // --- Credits ---

  async buyCredits(options: BuyCreditsRequest): Promise<BuyCreditsResponse> {
    await this.svmReady;
    const r = await this.requestWithPayment("/v1/credits/purchase", {
      wallet_address: this.walletAddress,
      wallet_chain: this.walletChain,
      amount_usd: options.amountUsd,
    });
    return {
      accountId: r.account_id,
      creditedMicrocredits: r.credited_microcredits,
      amountUsd: r.amount_usd,
    };
  }

  // --- Account ---

  async getAccount(): Promise<AccountResponse> {
    const r = await this.request("GET", "/v1/account");
    return {
      id: r.id,
      walletAddress: r.wallet_address,
      walletChain: r.wallet_chain,
      creditBalance: r.credit_balance,
      availableBalance: r.available_balance,
      maxConcurrentSessions: r.max_concurrent_sessions,
      maxApiRate: r.max_api_rate,
      createdAt: r.created_at,
    };
  }

  async getTransactions(
    options?: PaginationOptions,
  ): Promise<TransactionsResponse> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.offset !== undefined)
      params.set("offset", String(options.offset));
    const qs = params.toString();
    const r = await this.request(
      "GET",
      `/v1/account/transactions${qs ? `?${qs}` : ""}`,
    );
    return {
      transactions: (r.transactions as Raw[]).map(mapTransaction),
      limit: r.limit,
      offset: r.offset,
    };
  }

  async getSessions(options?: SessionsOptions): Promise<SessionsResponse> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.offset !== undefined)
      params.set("offset", String(options.offset));
    if (options?.status) params.set("status", options.status);
    const qs = params.toString();
    const r = await this.request(
      "GET",
      `/v1/account/sessions${qs ? `?${qs}` : ""}`,
    );
    return {
      sessions: (r.sessions as Raw[]).map(mapSession),
      limit: r.limit,
      offset: r.offset,
    };
  }

  // --- Bundled Agent Session ---

  async createAgentSession(
    options: CreateAgentSessionRequest,
  ): Promise<AgentSessionResponse> {
    const r = await this.request("POST", "/v1/agent-session", {
      room_name: options.roomName,
      participant_identity: options.participantIdentity,
      duration_minutes: options.durationMinutes,
      language: options.language,
      tts_max_characters: options.ttsMaxCharacters,
      metadata: options.metadata,
      client_identity: options.clientIdentity,
      client_ip: options.clientIp,
    });
    return {
      bundleId: r.bundle_id,
      webrtc: {
        agent: {
          sessionId: r.webrtc.agent.session_id,
          token: r.webrtc.agent.token,
          wsUrl: r.webrtc.agent.ws_url,
        },
        client: {
          sessionId: r.webrtc.client.session_id,
          token: r.webrtc.client.token,
          wsUrl: r.webrtc.client.ws_url,
        },
      },
      stt: {
        sessionId: r.stt.session_id,
        token: r.stt.token,
        serverUrl: r.stt.server_url,
      },
      tts: {
        sessionId: r.tts.session_id,
        token: r.tts.token,
        serverUrl: r.tts.server_url,
      },
      expiresAt: r.expires_at,
    };
  }

  async extendAgentSession(
    options: ExtendAgentSessionRequest,
  ): Promise<ExtendAgentSessionResponse> {
    const r = await this.request("POST", "/v1/agent-session/extend", {
      bundle_id: options.bundleId,
      additional_minutes: options.additionalMinutes,
      additional_tts_characters: options.additionalTtsCharacters,
    });
    const result: ExtendAgentSessionResponse = {};
    if (r.webrtc) {
      result.webrtc = {};
      if (r.webrtc.agent) {
        result.webrtc.agent = {
          token: r.webrtc.agent.token,
          newExpiresAt: r.webrtc.agent.new_expires_at,
        };
      }
      if (r.webrtc.client) {
        result.webrtc.client = {
          token: r.webrtc.client.token,
          newExpiresAt: r.webrtc.client.new_expires_at,
        };
      }
    }
    if (r.stt) {
      result.stt = {
        token: r.stt.token,
        newExpiresAt: r.stt.new_expires_at,
      };
    }
    if (r.tts) {
      result.tts = {
        token: r.tts.token,
        newExpiresAt: r.tts.new_expires_at,
      };
    }
    return result;
  }

  // --- Standalone WebRTC ---

  async createWebRTCToken(
    options: CreateWebRTCTokenRequest,
  ): Promise<WebRTCTokenResponse> {
    const r = await this.request("POST", "/v1/webrtc/token", {
      room_name: options.roomName,
      participant_identity: options.participantIdentity,
      duration_minutes: options.durationMinutes,
      metadata: options.metadata,
      client_ip: options.clientIp,
    });
    return {
      sessionId: r.session_id,
      token: r.token,
      wsUrl: r.ws_url,
      expiresAt: r.expires_at,
    };
  }

  async extendWebRTCToken(
    options: ExtendWebRTCTokenRequest,
  ): Promise<ExtendWebRTCTokenResponse> {
    const r = await this.request("POST", "/v1/webrtc/token/extend", {
      session_id: options.sessionId,
      additional_minutes: options.additionalMinutes,
    });
    return {
      token: r.token,
      wsUrl: r.ws_url,
      newExpiresAt: r.new_expires_at,
    };
  }

  // --- Standalone STT ---

  async createSTTSession(
    options: CreateSTTSessionRequest,
  ): Promise<STTSessionResponse> {
    const r = await this.request("POST", "/v1/stt/session", {
      duration_minutes: options.durationMinutes,
      language: options.language,
    });
    return {
      sessionId: r.session_id,
      token: r.token,
      serverUrl: r.server_url,
      expiresAt: r.expires_at,
    };
  }

  async extendSTTSession(
    options: ExtendSTTSessionRequest,
  ): Promise<ExtendSTTSessionResponse> {
    const r = await this.request("POST", "/v1/stt/session/extend", {
      session_id: options.sessionId,
      additional_minutes: options.additionalMinutes,
    });
    return {
      token: r.token,
      newExpiresAt: r.new_expires_at,
    };
  }

  // --- Standalone TTS ---

  async createTTSSession(
    options: CreateTTSSessionRequest,
  ): Promise<TTSSessionResponse> {
    const r = await this.request("POST", "/v1/tts/session", {
      max_characters: options.maxCharacters,
      language: options.language,
    });
    return {
      sessionId: r.session_id,
      token: r.token,
      serverUrl: r.server_url,
      expiresAt: r.expires_at,
    };
  }

  async extendTTSSession(
    options: ExtendTTSSessionRequest,
  ): Promise<ExtendTTSSessionResponse> {
    const r = await this.request("POST", "/v1/tts/session/extend", {
      session_id: options.sessionId,
      additional_characters: options.additionalCharacters,
    });
    return {
      token: r.token,
      maxCharacters: r.max_characters,
      newExpiresAt: r.new_expires_at,
    };
  }

  /** Upload a file for asynchronous transcription. No automatic upload retry. */
  async createFileTranscription(options: CreateFileTranscriptionRequest): Promise<FileTranscriptionJob> {
    if (!/^[\x21-\x7e]{1,128}$/.test(options.idempotencyKey)) throw new Error("A valid idempotencyKey is required");
    const form = new FormData();
    form.append("file", options.file, options.filename ?? "audio.media");
    if (options.language !== undefined) form.append("language", options.language);
    if (options.diarize !== undefined) form.append("diarize", String(options.diarize));
    return mapFileJob(await this.request("POST", "/v1/transcriptions/jobs", form, { "Idempotency-Key": options.idempotencyKey }));
  }

  async getFileTranscription(jobId: string): Promise<FileTranscriptionJob> {
    return mapFileJob(await this.request("GET", `/v1/transcriptions/jobs/${encodeURIComponent(jobId)}`));
  }

  /** Cancels unfinished work; completed result deletion preserves its charge. */
  async deleteFileTranscription(jobId: string): Promise<FileTranscriptionJob> {
    return mapFileJob(await this.request("DELETE", `/v1/transcriptions/jobs/${encodeURIComponent(jobId)}`));
  }

  /** Own-model snapshot analysis. No automatic retry or credit purchase. */
  async createVisionSnapshot(options: CreateVisionSnapshotRequest): Promise<VisionSnapshot> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.idempotencyKey)) throw new Error("A valid idempotencyKey is required");
    const form = new FormData();
    form.append("image", options.image, "image.media");
    if (options.question !== undefined) form.append("question", options.question);
    return mapVisionSnapshot(await this.request("POST", "/v1/vision/snapshot", form, { "Idempotency-Key": options.idempotencyKey }));
  }

  /** Poll an in-flight request or retrieve its persisted answer without another charge. */
  async getVisionSnapshot(requestId: string): Promise<VisionSnapshot> {
    return mapVisionSnapshot(await this.request("GET", `/v1/vision/requests/${encodeURIComponent(requestId)}`));
  }

  /** No room, WebRTC session or prepaid duration is required. */
  async createModerationStream(): Promise<ModerationStreamTicket> {
    const r = await this.request("POST", "/v1/moderation/streams");
    const url = new URL("/v1/moderation/stream", this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return { token: r.token, websocketUrl: url.toString(), expiresAt: r.expires_at, protocol: r.protocol };
  }

  async moderateAudio(options: { audio: Blob; language?: string; idempotencyKey: string }): Promise<ModerationInference> {
    return this.uploadModeration("audio", options.audio, options.idempotencyKey, options.language);
  }
  async moderateVideoFrame(options: { image: Blob; idempotencyKey: string }): Promise<ModerationInference> {
    return this.uploadModeration("video-frame", options.image, options.idempotencyKey);
  }
  async getModerationRequest(id: string): Promise<ModerationInference> {
    return mapModerationInference(await this.request("GET", `/v1/moderation/requests/${encodeURIComponent(id)}`));
  }
  private async uploadModeration(path: "audio" | "video-frame", media: Blob, key: string, language?: string): Promise<ModerationInference> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new Error("A valid idempotencyKey is required");
    const form = new FormData(); form.append(path === "audio" ? "audio" : "image", media, "media.bin");
    if (language !== undefined) form.append("language", language);
    return mapModerationInference(await this.request("POST", `/v1/moderation/${path}`, form, { "Idempotency-Key": key }));
  }

  /** Text translation billed per Unicode code point of `q`. No automatic retry or credit purchase. */
  async translate(options: TranslateRequest): Promise<TranslationRequest> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.idempotencyKey)) throw new Error("A valid idempotencyKey is required");
    const body = { q: options.q, target: options.target, ...(options.source !== undefined ? { source: options.source } : {}) };
    return mapTranslation(await this.request("POST", "/v1/translation", body, { "Idempotency-Key": options.idempotencyKey }));
  }

  /** Poll an in-flight translation or retrieve its persisted result without another charge. */
  async getTranslation(id: string): Promise<TranslationRequest> {
    return mapTranslation(await this.request("GET", `/v1/translation/requests/${encodeURIComponent(id)}`));
  }

  // --- Internal: authenticated request ---

  private async request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<Raw> {
    const headers = this.account
      ? await createAuthHeaders(this.account, method, path)
      : await createSolanaAuthHeaders(this.solanaAccount!, method, path);
    const multipart = body instanceof FormData;
    const init: RequestInit = {
      method,
      headers: {
        ...headers,
        ...extraHeaders,
        ...(!multipart && body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}),
    };

    const resp = await fetch(`${this.baseUrl}${path}`, init);
    return this.handleResponse(resp, path);
  }

  // --- Internal: x402 payment request (for buyCredits) ---

  private async requestWithPayment(path: string, body: unknown): Promise<Raw> {
    let resp: Response;
    try {
      resp = await this.fetchWithPayment(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new PaymentError(
        `Payment failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return this.handleResponse(resp, path);
  }

  // --- Internal: response handling ---

  private async handleResponse(resp: Response, path: string): Promise<Raw> {
    if (resp.ok) {
      return (await resp.json()) as Raw;
    }

    const text = await resp.text().catch(() => "");
    let errorMessage: string;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      errorMessage = parsed.error ?? text;
    } catch {
      errorMessage = text || resp.statusText;
    }

    switch (resp.status) {
      case 402:
        throw new InsufficientCreditsError(errorMessage);
      case 429: {
        if (errorMessage.toLowerCase().includes("concurrent")) {
          throw new ConcurrencyLimitError(errorMessage);
        }
        throw new RateLimitError(errorMessage);
      }
      case 503: {
        const service = path.split("/")[2] ?? "unknown";
        throw new NoCapacityError(errorMessage, service);
      }
      default:
        throw new GatewayError(errorMessage, resp.status);
    }
  }
}

// --- Response mappers for array items ---

function mapTransaction(r: Raw): Transaction {
  return {
    id: r.id,
    amount: r.amount,
    balanceAfter: r.balance_after,
    type: r.type,
    referenceId: r.reference_id,
    service: r.service,
    description: r.description,
    createdAt: r.created_at,
  };
}

function mapSession(r: Raw): Session {
  return {
    id: r.id,
    service: r.service,
    bundleId: r.bundle_id,
    status: r.status,
    roomName: r.room_name,
    serverUrl: r.server_url,
    reservedMicrocredits: r.reserved_microcredits,
    chargedMicrocredits: r.charged_microcredits,
    tokenExpiresAt: r.token_expires_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    settlementMethod: r.settlement_method,
    createdAt: r.created_at,
  };
}

function mapFileJob(r: Raw): FileTranscriptionJob {
  return { id: r.id, status: r.status, durationSeconds: r.duration_seconds, result: r.result, error: r.error };
}

function mapVisionSnapshot(r: Raw): VisionSnapshot {
  const value = r.result;
  return { id: r.id, status: r.status, chargedMicrocredits: r.charged_microcredits,
    ...(r.error !== undefined ? { error: r.error } : {}),
    ...(value ? { result: { requestId: value.request_id,
      answer: value.answer, model: value.model, generatedTokens: value.generated_tokens, promptTokens: value.prompt_tokens,
      finishReason: value.finish_reason, outputTokenLimitReached: value.output_token_limit_reached,
      usage: { completedSnapshots: value.usage.completed_snapshots } } } : {}) };
}

export function mapModerationInference(r: Raw): ModerationInference {
  if (!r || typeof r !== "object" || Array.isArray(r) || typeof r.id !== "string" || !r.id ||
      !["moderation-audio", "moderation-video"].includes(r.kind) || !["running", "completed", "failed"].includes(r.status) ||
      typeof r.charged_microcredits !== "string" || !/^[0-9]+$/.test(r.charged_microcredits)) throw new Error("Invalid moderation response");
  return { id: r.id, kind: r.kind, status: r.status, chargedMicrocredits: r.charged_microcredits,
    ...(r.result ? { result: r.result } : {}), ...(r.error ? { error: r.error } : {}) };
}

function mapTranslation(r: Raw): TranslationRequest {
  if (!r || typeof r !== "object" || Array.isArray(r) || typeof r.id !== "string" || !r.id || r.kind !== "translation" ||
      !["running", "completed", "failed"].includes(r.status) ||
      typeof r.charged_microcredits !== "string" || !/^[0-9]+$/.test(r.charged_microcredits)) throw new Error("Invalid translation response");
  const value = r.result;
  return { id: r.id, kind: r.kind, status: r.status, chargedMicrocredits: r.charged_microcredits,
    ...(r.error ? { error: r.error } : {}),
    ...(value ? { result: { translatedText: value.translated_text, source: value.source, target: value.target,
      ...(value.detected_language ? { detectedLanguage: { language: value.detected_language.language, confidence: value.detected_language.confidence } } : {}),
      usage: { characters: value.usage.characters, ...(typeof value.usage.output_tokens === "number" ? { outputTokens: value.usage.output_tokens } : {}) } } } : {}) };
}
