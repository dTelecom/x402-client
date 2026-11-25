// Ported from IncentivNetwork/incentiv-x402-public @ 4e3feeec41c88130100b25467c850e168dd771fe
// (src/constants.ts). Copyright (c) 2026 Incentiv, MIT License — see THIRD_PARTY_NOTICES.md.
import type { Address } from "viem";

export const INCENTIV_NETWORK = "eip155:24101" as const;
export const INCENTIV_CHAIN_ID = 24101;
export const INCENTIV_EOA_SCHEME = "incentiv-eoa-tx";
export const INCENTIV_USEROP_SCHEME = "incentiv-userop";
export const INCENTIV_PURCHASE_PATH = "/v1/credits/purchase/incentiv";

export interface IncentivConfig {
  chainId: number;
  rpcUrl: string;
  bundlerUrl: string;
  entryPoint: Address;
  accountFactory: Address;
  paymaster: Address;
  quoter: Address;
  wcent: Address;
  usdc: Address;
}

/** Incentiv Mainnet (Incentiv x402 SPEC.md section 1). */
export const INCENTIV_MAINNET: IncentivConfig = {
  chainId: INCENTIV_CHAIN_ID,
  rpcUrl: "https://rpc.incentiv.io",
  bundlerUrl: "https://bundler.incentiv.io",
  entryPoint: "0x3eC61c5633BBD7Afa9144C6610930489736a72d4",
  accountFactory: "0xfED842F3C1d054361A840AE863C0b72db5CB2a32",
  paymaster: "0x43000f785EB43BcB4961C5c70276eD00e088972c",
  quoter: "0x1d317fFfBc3Bda5aA06F9f8f506e8C6082dC415A",
  wcent: "0xB0f0A14A50F14dc9e6476d61C00cF0375Dd4EB04",
  usdc: "0x16e43840d8D79896A389a3De85aB0B0210C05685",
};

export const USDC_DECIMALS = 6;
export const ZERO32 = `0x${"0".repeat(64)}` as const;
/** The facilitator refuses a standard-wallet payment with a higher gas limit. */
export const MAX_EOA_GAS = 120_000n;
/** Default `maxGasFee`: 0.25 USDC paid to the paymaster for one smart-account payment. */
export const DEFAULT_MAX_GAS_FEE = 250_000n;
/** Default `maxNativeGasCost`: 100 CENT reserved for gas by one smart-account payment. */
export const DEFAULT_MAX_NATIVE_GAS_COST = 100n * 10n ** 18n;
