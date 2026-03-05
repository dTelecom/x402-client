import { describe, it, expect, vi, beforeEach } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import type { LocalAccount } from "viem/accounts";

// Test private key (DO NOT use in production)
const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

// Create real viem account for auth tests
const testAccount: LocalAccount = privateKeyToAccount(TEST_KEY);

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn<typeof fetch>();

vi.stubGlobal("fetch", mockFetch);

// Mock @x402/fetch and @x402/evm so they don't need real blockchain access
vi.mock("@x402/fetch", () => {
  const x402ClientClass = vi.fn().mockReturnValue({});
  return {
    x402Client: x402ClientClass,
    wrapFetchWithPayment: (_fetch: typeof fetch, _client: unknown) => mockFetch,
  };
});

vi.mock("@x402/evm/exact/client", () => ({
  registerExactEvmScheme: vi.fn().mockReturnValue({}),
}));

vi.mock("@x402/evm", () => ({
  toClientEvmSigner: vi.fn().mockReturnValue({}),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({}),
  };
});

// Mock @solana/kit for base58 encoding (string → bytes)
vi.mock("@solana/kit", () => ({
  getBase58Encoder: () => ({
    encode: (input: string) => {
      // Simple mock: return deterministic 64-byte Ed25519 signature
      const bytes = new Uint8Array(64);
      for (let i = 0; i < 64; i++) bytes[i] = i;
      return bytes;
    },
  }),
}));

// Mock @x402/svm/exact/client
vi.mock("@x402/svm/exact/client", () => ({
  registerExactSvmScheme: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import { DtelecomGateway, type DtelecomGatewayConfig } from "../src/client.js";
import { createAuthHeaders, createSolanaAuthHeaders } from "../src/auth.js";
import type { SolanaSigner } from "../src/types.js";
import {
  GatewayError,
  InsufficientCreditsError,
  ConcurrencyLimitError,
  RateLimitError,
  NoCapacityError,
  PaymentError,
} from "../src/errors.js";

// Mock Solana signer for testing
const SOLANA_ADDRESS = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";

function createMockSolanaSigner(): SolanaSigner {
  return {
    address: SOLANA_ADDRESS,
    signMessages: vi.fn().mockResolvedValue([
      { [SOLANA_ADDRESS]: "MockBase58Signature" },
    ]),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createAuthHeaders", () => {
  it("produces correct header structure", async () => {
    const headers = await createAuthHeaders(testAccount, "GET", "/v1/account");

    expect(headers["X-Wallet-Address"]).toBe(testAccount.address);
    expect(headers["X-Wallet-Chain"]).toBe("evm");
    expect(headers.Authorization).toMatch(/^evm:0x[0-9a-f]+$/i);
    expect(Number(headers["X-Timestamp"])).toBeGreaterThan(0);
  });

  it("signs the correct message format", async () => {
    const before = Math.floor(Date.now() / 1000);
    const headers = await createAuthHeaders(
      testAccount,
      "POST",
      "/v1/webrtc/token",
    );
    const after = Math.floor(Date.now() / 1000);

    const ts = Number(headers["X-Timestamp"]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("strips query params from signed message", async () => {
    const headers = await createAuthHeaders(
      testAccount,
      "GET",
      "/v1/account/transactions?limit=10&offset=5",
    );

    // Recover the message that was signed and verify it uses pathname only
    const signature = headers.Authorization.split(":")[1] as `0x${string}`;
    const ts = headers["X-Timestamp"];
    const expectedMessage = `GET\n/v1/account/transactions\n${ts}`;

    const valid = await verifyMessage({
      address: testAccount.address,
      message: expectedMessage,
      signature,
    });
    expect(valid).toBe(true);

    // Confirm signing the full path with query string does NOT match
    const wrongMessage = `GET\n/v1/account/transactions?limit=10&offset=5\n${ts}`;
    const invalid = await verifyMessage({
      address: testAccount.address,
      message: wrongMessage,
      signature,
    });
    expect(invalid).toBe(false);
  });
});

describe("DtelecomGateway", () => {
  let gw: DtelecomGateway;

  beforeEach(() => {
    mockFetch.mockReset();
    gw = new DtelecomGateway({
      gatewayUrl: "https://x402.dtelecom.org",
      account: testAccount,
    });
  });

  // --- Account ---

  describe("getAccount", () => {
    it("calls GET /v1/account with auth headers", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: "acc-1",
          wallet_address: "0xabc",
          wallet_chain: "evm",
          credit_balance: "5000000",
          available_balance: "4000000",
          max_concurrent_sessions: 10,
          max_api_rate: 5,
          created_at: "2025-01-01T00:00:00Z",
        }),
      );

      const result = await gw.getAccount();

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://x402.dtelecom.org/v1/account");
      expect((init as RequestInit).method).toBe("GET");

      // Verify camelCase mapping
      expect(result.creditBalance).toBe("5000000");
      expect(result.availableBalance).toBe("4000000");
      expect(result.maxConcurrentSessions).toBe(10);
      expect(result.walletAddress).toBe("0xabc");
    });
  });

  describe("getTransactions", () => {
    it("appends pagination params", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ transactions: [], limit: 10, offset: 5 }),
      );

      await gw.getTransactions({ limit: 10, offset: 5 });

      const [url] = mockFetch.mock.calls[0];
      expect(String(url)).toContain("limit=10");
      expect(String(url)).toContain("offset=5");
    });
  });

  describe("getSessions", () => {
    it("appends status filter", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ sessions: [], limit: 50, offset: 0 }),
      );

      await gw.getSessions({ status: "active" });

      const [url] = mockFetch.mock.calls[0];
      expect(String(url)).toContain("status=active");
    });
  });

  // --- Credits (x402 payment) ---

  describe("buyCredits", () => {
    it("sends payment request with wallet_address and amount_usd", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          account_id: "acc-1",
          credited_microcredits: "100000",
          amount_usd: 0.1,
        }),
      );

      const result = await gw.buyCredits({ amountUsd: 0.1 });

      expect(result.accountId).toBe("acc-1");
      expect(result.creditedMicrocredits).toBe("100000");
      expect(result.amountUsd).toBe(0.1);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe("https://x402.dtelecom.org/v1/credits/purchase");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.wallet_address).toBe(testAccount.address);
      expect(body.wallet_chain).toBe("evm");
      expect(body.amount_usd).toBe(0.1);
    });

    it("throws PaymentError when x402 fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Insufficient USDC balance"));

      await expect(gw.buyCredits({ amountUsd: 0.1 })).rejects.toThrow(
        PaymentError,
      );
    });
  });

  // --- WebRTC ---

  describe("createWebRTCToken", () => {
    it("sends correct snake_case body", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          session_id: "sess-1",
          token: "jwt-token",
          ws_url: "wss://sfu.example.com",
          expires_at: "2025-01-01T01:00:00Z",
        }),
      );

      const result = await gw.createWebRTCToken({
        roomName: "room-1",
        participantIdentity: "user-1",
        durationMinutes: 30,
        metadata: '{"role":"agent"}',
      });

      expect(result.sessionId).toBe("sess-1");
      expect(result.wsUrl).toBe("wss://sfu.example.com");

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.room_name).toBe("room-1");
      expect(body.participant_identity).toBe("user-1");
      expect(body.duration_minutes).toBe(30);
    });
  });

  describe("extendWebRTCToken", () => {
    it("sends session_id and additional_minutes", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          token: "new-jwt",
          ws_url: "wss://sfu.example.com",
          new_expires_at: "2025-01-01T02:00:00Z",
        }),
      );

      const result = await gw.extendWebRTCToken({
        sessionId: "sess-1",
        additionalMinutes: 15,
      });

      expect(result.token).toBe("new-jwt");
      expect(result.newExpiresAt).toBe("2025-01-01T02:00:00Z");

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.session_id).toBe("sess-1");
      expect(body.additional_minutes).toBe(15);
    });
  });

  // --- STT ---

  describe("createSTTSession", () => {
    it("sends duration_minutes and optional language", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          session_id: "stt-1",
          token: "stt-token",
          server_url: "https://stt.example.com",
          expires_at: "2025-01-01T01:00:00Z",
        }),
      );

      const result = await gw.createSTTSession({
        durationMinutes: 10,
        language: "en",
      });

      expect(result.sessionId).toBe("stt-1");
      expect(result.serverUrl).toBe("https://stt.example.com");

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.duration_minutes).toBe(10);
      expect(body.language).toBe("en");
    });
  });

  describe("extendSTTSession", () => {
    it("sends session_id and additional_minutes", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          token: "new-stt-token",
          new_expires_at: "2025-01-01T02:00:00Z",
        }),
      );

      const result = await gw.extendSTTSession({
        sessionId: "stt-1",
        additionalMinutes: 5,
      });

      expect(result.token).toBe("new-stt-token");
      expect(result.newExpiresAt).toBe("2025-01-01T02:00:00Z");
    });
  });

  // --- TTS ---

  describe("createTTSSession", () => {
    it("sends max_characters and optional language", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          session_id: "tts-1",
          token: "tts-token",
          server_url: "https://tts.example.com",
          expires_at: "2025-01-01T01:00:00Z",
        }),
      );

      const result = await gw.createTTSSession({
        maxCharacters: 50000,
        language: "en",
      });

      expect(result.sessionId).toBe("tts-1");

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.max_characters).toBe(50000);
    });
  });

  describe("extendTTSSession", () => {
    it("sends session_id and additional_characters", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          token: "new-tts-token",
          max_characters: 100000,
          new_expires_at: "2025-01-01T02:00:00Z",
        }),
      );

      const result = await gw.extendTTSSession({
        sessionId: "tts-1",
        additionalCharacters: 50000,
      });

      expect(result.token).toBe("new-tts-token");
      expect(result.maxCharacters).toBe(100000);

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.session_id).toBe("tts-1");
      expect(body.additional_characters).toBe(50000);
    });
  });

  // --- Agent Session ---

  describe("createAgentSession", () => {
    it("sends all fields and maps nested response", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          bundle_id: "bundle-1",
          webrtc: {
            agent: {
              session_id: "wa-1",
              token: "wa-token",
              ws_url: "wss://sfu.example.com",
            },
            client: {
              session_id: "wc-1",
              token: "wc-token",
              ws_url: "wss://sfu.example.com",
            },
          },
          stt: {
            session_id: "s-1",
            token: "s-token",
            server_url: "https://stt.example.com",
          },
          tts: {
            session_id: "t-1",
            token: "t-token",
            server_url: "https://tts.example.com",
          },
          expires_at: "2025-01-01T01:00:00Z",
        }),
      );

      const result = await gw.createAgentSession({
        roomName: "room-1",
        participantIdentity: "agent-1",
        durationMinutes: 30,
        language: "en",
        ttsMaxCharacters: 50000,
        clientIdentity: "client-1",
      });

      expect(result.bundleId).toBe("bundle-1");
      expect(result.webrtc.agent.sessionId).toBe("wa-1");
      expect(result.webrtc.agent.wsUrl).toBe("wss://sfu.example.com");
      expect(result.webrtc.client.sessionId).toBe("wc-1");
      expect(result.webrtc.client.token).toBe("wc-token");
      expect(result.stt.serverUrl).toBe("https://stt.example.com");
      expect(result.tts.serverUrl).toBe("https://tts.example.com");

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.room_name).toBe("room-1");
      expect(body.participant_identity).toBe("agent-1");
      expect(body.duration_minutes).toBe(30);
      expect(body.tts_max_characters).toBe(50000);
      expect(body.client_identity).toBe("client-1");
    });
  });

  describe("extendAgentSession", () => {
    it("sends bundle_id and additional params", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          webrtc: {
            agent: { token: "new-wa", new_expires_at: "2025-01-01T02:00:00Z" },
            client: { token: "new-wc", new_expires_at: "2025-01-01T02:00:00Z" },
          },
          stt: { token: "new-s", new_expires_at: "2025-01-01T02:00:00Z" },
          tts: { token: "new-t", new_expires_at: "2025-01-01T02:00:00Z" },
        }),
      );

      const result = await gw.extendAgentSession({
        bundleId: "bundle-1",
        additionalMinutes: 15,
        additionalTtsCharacters: 10000,
      });

      expect(result.webrtc?.agent?.token).toBe("new-wa");
      expect(result.webrtc?.client?.token).toBe("new-wc");
      expect(result.stt?.newExpiresAt).toBe("2025-01-01T02:00:00Z");

      const body = JSON.parse(
        (mockFetch.mock.calls[0][1] as RequestInit).body as string,
      );
      expect(body.bundle_id).toBe("bundle-1");
      expect(body.additional_minutes).toBe(15);
      expect(body.additional_tts_characters).toBe(10000);
    });
  });

  // --- Error handling ---

  describe("error handling", () => {
    it("throws InsufficientCreditsError on 402", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "Insufficient credits" }, 402),
      );

      await expect(gw.getAccount()).rejects.toThrow(InsufficientCreditsError);
    });

    it("throws ConcurrencyLimitError on 429 with concurrent message", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "Concurrent session limit reached" }, 429),
      );

      await expect(
        gw.createWebRTCToken({
          roomName: "r",
          participantIdentity: "p",
          durationMinutes: 10,
        }),
      ).rejects.toThrow(ConcurrencyLimitError);
    });

    it("throws RateLimitError on 429 without concurrent message", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "Too many requests" }, 429),
      );

      await expect(gw.getAccount()).rejects.toThrow(RateLimitError);
    });

    it("throws NoCapacityError on 503", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "No STT servers available" }, 503),
      );

      await expect(
        gw.createSTTSession({ durationMinutes: 10 }),
      ).rejects.toThrow(NoCapacityError);
    });

    it("throws GatewayError on 400", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "Missing required fields" }, 400),
      );

      await expect(
        gw.createWebRTCToken({
          roomName: "",
          participantIdentity: "",
          durationMinutes: 0,
        }),
      ).rejects.toThrow(GatewayError);
    });

    it("throws GatewayError on 404", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "Session not found" }, 404),
      );

      await expect(
        gw.extendWebRTCToken({ sessionId: "bad", additionalMinutes: 10 }),
      ).rejects.toThrow(GatewayError);
    });
  });

  // --- snake_case ↔ camelCase mapping ---

  describe("case mapping", () => {
    it("maps snake_case response to camelCase", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          id: "acc-1",
          wallet_address: "0xabc",
          wallet_chain: "evm",
          credit_balance: "5000000",
          available_balance: "4000000",
          max_concurrent_sessions: 10,
          max_api_rate: 5,
          created_at: "2025-01-01T00:00:00Z",
        }),
      );

      const result = await gw.getAccount();
      expect(result).toHaveProperty("walletAddress");
      expect(result).toHaveProperty("creditBalance");
      expect(result).not.toHaveProperty("wallet_address");
      expect(result).not.toHaveProperty("credit_balance");
    });

    it("maps nested snake_case response to camelCase", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          bundle_id: "b-1",
          webrtc: {
            agent: { session_id: "wa-1", token: "t", ws_url: "wss://x" },
            client: { session_id: "wc-1", token: "t", ws_url: "wss://x" },
          },
          stt: { session_id: "s-1", token: "t", server_url: "https://x" },
          tts: { session_id: "t-1", token: "t", server_url: "https://x" },
          expires_at: "2025-01-01T00:00:00Z",
        }),
      );

      const result = await gw.createAgentSession({
        roomName: "room",
        participantIdentity: "agent",
        durationMinutes: 10,
      });

      expect(result.webrtc.agent.sessionId).toBe("wa-1");
      expect(result.webrtc.agent.wsUrl).toBe("wss://x");
      expect(result.webrtc.client.sessionId).toBe("wc-1");
      expect(result.stt.serverUrl).toBe("https://x");
    });

    it("maps array items in response", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          transactions: [
            {
              id: "tx-1",
              amount: "100000",
              balance_after: "5000000",
              type: "purchase",
              reference_id: "ref-1",
              service: null,
              description: "Credit purchase",
              created_at: "2025-01-01T00:00:00Z",
            },
          ],
          limit: 50,
          offset: 0,
        }),
      );

      const result = await gw.getTransactions();
      expect(result.transactions[0].balanceAfter).toBe("5000000");
      expect(result.transactions[0].referenceId).toBe("ref-1");
    });
  });
});

// ===========================================================================
// Solana support tests
// ===========================================================================

describe("createSolanaAuthHeaders", () => {
  it("produces correct header structure", async () => {
    const signer = createMockSolanaSigner();
    const headers = await createSolanaAuthHeaders(signer, "GET", "/v1/account");

    expect(headers["X-Wallet-Address"]).toBe(SOLANA_ADDRESS);
    expect(headers["X-Wallet-Chain"]).toBe("solana");
    expect(headers.Authorization).toMatch(/^solana:.+$/);
    expect(Number(headers["X-Timestamp"])).toBeGreaterThan(0);
  });

  it("signs the correct message bytes", async () => {
    const signer = createMockSolanaSigner();
    await createSolanaAuthHeaders(signer, "POST", "/v1/webrtc/token");

    expect(signer.signMessages).toHaveBeenCalledOnce();
    const call = (signer.signMessages as ReturnType<typeof vi.fn>).mock.calls[0];
    const content = call[0][0].content as Uint8Array;
    const decoded = new TextDecoder().decode(content);
    // Message format: METHOD\nPATHNAME\nTIMESTAMP
    expect(decoded).toMatch(/^POST\n\/v1\/webrtc\/token\n\d+$/);
  });

  it("produces base64-encoded signature", async () => {
    const signer = createMockSolanaSigner();
    const headers = await createSolanaAuthHeaders(signer, "GET", "/v1/account");

    const sig = headers.Authorization.split(":")[1];
    // Should be valid base64 (our mock produces deterministic 64-byte output)
    expect(() => Buffer.from(sig, "base64")).not.toThrow();
    expect(Buffer.from(sig, "base64").length).toBe(64);
  });

  it("strips query params from signed message", async () => {
    const signer = createMockSolanaSigner();
    await createSolanaAuthHeaders(
      signer,
      "GET",
      "/v1/account/transactions?limit=10&offset=5",
    );

    const call = (signer.signMessages as ReturnType<typeof vi.fn>).mock.calls[0];
    const decoded = new TextDecoder().decode(call[0][0].content as Uint8Array);
    expect(decoded).toMatch(/^GET\n\/v1\/account\/transactions\n\d+$/);
    expect(decoded).not.toContain("limit=10");
  });
});

describe("DtelecomGateway (Solana)", () => {
  let gw: DtelecomGateway;
  let solanaSigner: SolanaSigner;

  beforeEach(() => {
    mockFetch.mockReset();
    solanaSigner = createMockSolanaSigner();
    gw = new DtelecomGateway({
      gatewayUrl: "https://x402.dtelecom.org",
      solanaAccount: solanaSigner,
    });
  });

  it("sends solana auth headers on requests", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: "acc-1",
        wallet_address: SOLANA_ADDRESS,
        wallet_chain: "solana",
        credit_balance: "5000000",
        available_balance: "4000000",
        max_concurrent_sessions: 10,
        max_api_rate: 5,
        created_at: "2025-01-01T00:00:00Z",
      }),
    );

    await gw.getAccount();

    const [, init] = mockFetch.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^solana:.+$/);
    expect(headers["X-Wallet-Chain"]).toBe("solana");
    expect(headers["X-Wallet-Address"]).toBe(SOLANA_ADDRESS);
  });

  it("sends wallet_chain: solana in buyCredits", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        account_id: "acc-1",
        credited_microcredits: "100000",
        amount_usd: 0.1,
      }),
    );

    await gw.buyCredits({ amountUsd: 0.1 });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.wallet_chain).toBe("solana");
    expect(body.wallet_address).toBe(SOLANA_ADDRESS);
  });
});

describe("DtelecomGateway constructor validation", () => {
  it("throws if neither account nor solanaAccount provided", () => {
    expect(
      () => new DtelecomGateway({ gatewayUrl: "https://x402.dtelecom.org" } as DtelecomGatewayConfig),
    ).toThrow("Either account (EVM) or solanaAccount (Solana) must be provided");
  });

  it("accepts EVM account only", () => {
    expect(
      () => new DtelecomGateway({ account: testAccount }),
    ).not.toThrow();
  });

  it("accepts Solana account only", () => {
    expect(
      () => new DtelecomGateway({ solanaAccount: createMockSolanaSigner() }),
    ).not.toThrow();
  });
});
