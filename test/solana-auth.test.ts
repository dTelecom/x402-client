/** Solana wallet auth with a real @solana/kit signer, verified the way the gateway verifies it. */
import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateKeyPairSigner, getBase58Encoder } from "@solana/kit";
import { createSolanaAuthHeaders } from "../src/auth.js";

function gatewayVerifies(address: string, message: string, base64Sig: string): boolean {
  const publicKey = Uint8Array.from(getBase58Encoder().encode(address));
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]), Buffer.from(publicKey)]),
    format: "der",
    type: "spki",
  });
  return verify(null, new TextEncoder().encode(message), key, Buffer.from(base64Sig, "base64"));
}

describe("createSolanaAuthHeaders with @solana/kit", () => {
  it("signs with a KeyPairSigner (signature bytes) in the format the gateway verifies", async () => {
    const signer = await generateKeyPairSigner();
    const headers = await createSolanaAuthHeaders(signer, "GET", "/v1/account?x=1");
    const signature = headers.Authorization.replace(/^solana:/, "");
    expect(gatewayVerifies(signer.address, `GET\n/v1/account\n${headers["X-Timestamp"]}`, signature)).toBe(true);
  });
});
