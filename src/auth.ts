import type { LocalAccount } from "viem/accounts";
import type { SolanaSigner } from "./types.js";

export interface AuthHeaders {
  Authorization: string;
  "X-Wallet-Address": string;
  "X-Wallet-Chain": string;
  "X-Timestamp": string;
}

/**
 * Create wallet-auth headers for the gateway (EVM).
 *
 * Signs: `${METHOD}\n${path}\n${timestamp}`
 * Result: `Authorization: evm:<signature>`
 */
export async function createAuthHeaders(
  account: LocalAccount,
  method: string,
  path: string,
): Promise<AuthHeaders> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const pathname = path.split("?")[0];
  const message = `${method}\n${pathname}\n${timestamp}`;
  const signature = await account.signMessage({ message });
  return {
    Authorization: `evm:${signature}`,
    "X-Wallet-Address": account.address,
    "X-Wallet-Chain": "evm",
    "X-Timestamp": timestamp,
  };
}

/**
 * Create wallet-auth headers for the gateway (Solana).
 *
 * Signs: `${METHOD}\n${path}\n${timestamp}` as raw bytes (Ed25519).
 * Converts base58 signature → base64 for the gateway.
 * Result: `Authorization: solana:<base64sig>`
 */
export async function createSolanaAuthHeaders(
  signer: SolanaSigner,
  method: string,
  path: string,
): Promise<AuthHeaders> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const pathname = path.split("?")[0];
  const message = `${method}\n${pathname}\n${timestamp}`;
  const messageBytes = new TextEncoder().encode(message);

  const [sigDict] = await signer.signMessages([{ content: messageBytes }]);
  const base58Sig = sigDict[signer.address];

  // Encode base58 string → raw bytes → base64
  const { getBase58Encoder } = await import("@solana/kit");
  const sigBytes = getBase58Encoder().encode(base58Sig);
  const base64Sig = Buffer.from(sigBytes).toString("base64");

  return {
    Authorization: `solana:${base64Sig}`,
    "X-Wallet-Address": signer.address,
    "X-Wallet-Chain": "solana",
    "X-Timestamp": timestamp,
  };
}
