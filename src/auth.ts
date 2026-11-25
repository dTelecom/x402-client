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
 * Sends the signature base64-encoded (from kit's signature bytes, or a base58 string from custom signers).
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
  const signature = sigDict[signer.address];
  if (signature === undefined) throw new Error("Solana signer returned no signature for its address");

  // @solana/kit signers return signature bytes; base58 strings are accepted for custom signers.
  let sigBytes: Uint8Array;
  if (typeof signature === "string") {
    const { getBase58Encoder } = await import("@solana/kit");
    sigBytes = Uint8Array.from(getBase58Encoder().encode(signature));
  } else {
    sigBytes = signature;
  }
  const base64Sig = Buffer.from(sigBytes).toString("base64");

  return {
    Authorization: `solana:${base64Sig}`,
    "X-Wallet-Address": signer.address,
    "X-Wallet-Chain": "solana",
    "X-Timestamp": timestamp,
  };
}
