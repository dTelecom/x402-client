/**
 * Incentiv payments for the dTelecom gateway: buy credits with USDC on Incentiv Mainnet.
 *
 *   import { DtelecomGateway } from "@dtelecom/x402-client";
 *   import { incentivRail } from "@dtelecom/x402-client/incentiv";
 *
 *   const gateway = new DtelecomGateway({ account, paymentRail: incentivRail({ wallet: "eoa" }) });
 *   await gateway.buyCredits({ amountUsd: 1 });
 *
 * Wallet types (all signed by the gateway `account` key):
 *   - "eoa": the standard wallet pays; it needs USDC and CENT for gas.
 *   - "smart-usdc": the key's Incentiv smart account pays; gas is paid in USDC to the paymaster.
 *   - "smart-cent": the key's Incentiv smart account pays; gas is paid in CENT.
 * Credits go to the gateway `account` address either way.
 *
 * Optional module: it uses only viem and @x402/fetch, which the main package already depends on.
 */
import type { Address } from "viem";
import type { LocalAccount } from "viem/accounts";
import type { x402Client } from "@x402/fetch";
import type { PaymentRail } from "../client.js";
import { erc20Abi } from "./abi.js";
import { INCENTIV_MAINNET, INCENTIV_NETWORK, INCENTIV_PURCHASE_PATH, type IncentivConfig } from "./constants.js";
import { IncentivEoaTxClientScheme, IncentivUserOpClientScheme } from "./schemes.js";
import { makeChain, smartAccountAddress } from "./userop.js";

export * from "./constants.js";
export { IncentivEoaTxClientScheme, IncentivUserOpClientScheme } from "./schemes.js";
export type { IncentivEoaSigner, IncentivOwnerSigner, IncentivUserOpOptions } from "./schemes.js";
export { IncentivPaymentError } from "./decode.js";

export type IncentivWallet = "eoa" | "smart-usdc" | "smart-cent";

export interface IncentivRailOptions {
  /** Which wallet pays. Default "eoa". */
  wallet?: IncentivWallet;
  /** Smart account CREATE2 salt. Default 0. */
  salt?: bigint;
  /** "smart-usdc": most USDC (atomic units, 6 decimals) paid to the paymaster for gas per purchase. Default 250000 (0.25 USDC). */
  maxGasFee?: bigint;
  /** "smart-cent": most CENT (wei) one purchase may reserve for gas. Default 100 CENT. */
  maxNativeGasCost?: bigint;
  /** Override RPC/bundler URLs or contracts. Default Incentiv Mainnet. */
  config?: Partial<IncentivConfig>;
}

function resolveConfig(config?: Partial<IncentivConfig>): IncentivConfig {
  return { ...INCENTIV_MAINNET, ...config };
}

function wallet(options: IncentivRailOptions): IncentivWallet {
  const w = options.wallet ?? "eoa";
  if (w !== "eoa" && w !== "smart-usdc" && w !== "smart-cent") throw new Error(`Unknown Incentiv wallet type: ${String(w)}`);
  return w;
}

/** Purchase rail for `DtelecomGateway({ paymentRail })`: pays `POST /v1/credits/purchase/incentiv`. */
export function incentivRail(options: IncentivRailOptions = {}): PaymentRail {
  const type = wallet(options);
  const cfg = resolveConfig(options.config);
  return {
    purchasePath: INCENTIV_PURCHASE_PATH,
    register(client: x402Client, account: LocalAccount) {
      const scheme = type === "eoa"
        ? new IncentivEoaTxClientScheme(account, cfg)
        : new IncentivUserOpClientScheme(account, {
          gas: type === "smart-cent" ? "native" : "token",
          salt: options.salt,
          maxGasFee: options.maxGasFee,
          maxNativeGasCost: options.maxNativeGasCost,
        }, cfg);
      client.register(INCENTIV_NETWORK, scheme);
    },
  };
}

/**
 * The Incentiv address that pays for this wallet type, i.e. the address to fund: the owner itself for
 * "eoa", its smart account for "smart-usdc" / "smart-cent" (known before the account is deployed).
 */
export async function incentivPaymentAddress(
  owner: Address,
  options: Pick<IncentivRailOptions, "wallet" | "salt" | "config"> = {},
): Promise<Address> {
  if (wallet(options) === "eoa") return owner;
  return smartAccountAddress(makeChain(resolveConfig(options.config)), owner, options.salt ?? 0n);
}

/** USDC (atomic units, 6 decimals) and CENT (wei) balances of an address on Incentiv. */
export async function incentivBalances(address: Address, config?: Partial<IncentivConfig>): Promise<{ usdc: bigint; cent: bigint }> {
  const cfg = resolveConfig(config);
  const { client } = makeChain(cfg);
  const [usdc, cent] = await Promise.all([
    client.readContract({ address: cfg.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    client.getBalance({ address }),
  ]);
  return { usdc, cent };
}
