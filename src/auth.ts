import type { LocalAccount } from "viem/accounts";

export interface AuthHeaders {
  Authorization: string;
  "X-Wallet-Address": string;
  "X-Wallet-Chain": string;
  "X-Timestamp": string;
}

/**
 * Create wallet-auth headers for the gateway.
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
