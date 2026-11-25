// Ported from IncentivNetwork/incentiv-x402-public @ 4e3feeec41c88130100b25467c850e168dd771fe
// (src/scheme/client-eoa.ts, src/scheme/client.ts). Copyright (c) 2026 Incentiv, MIT License —
// see THIRD_PARTY_NOTICES.md. Adapted to the @x402/core 2.5 SchemeNetworkClient interface.
import { getAddress, isAddressEqual, toHex, type Address, type Hex, type TransactionSerializableEIP1559 } from "viem";
import type { PaymentRequirements, SchemeNetworkClient } from "@x402/fetch";
import {
  DEFAULT_MAX_GAS_FEE, DEFAULT_MAX_NATIVE_GAS_COST, INCENTIV_EOA_SCHEME, INCENTIV_NETWORK, INCENTIV_USEROP_SCHEME,
  MAX_EOA_GAS, USDC_DECIMALS, type IncentivConfig,
} from "./constants.js";
import { checkPaysRequirements, deadlineMarker, decodeEoaPayment, decodePaymentOp, IncentivPaymentError } from "./decode.js";
import { makeChain, opToWire, preparePayment, requiredPrefund, smartAccountAddress, transferCall, type Chain } from "./userop.js";

/**
 * Lets x402 client spend controls (newer @x402/core) recognise Incentiv USDC as a known asset,
 * so its USD cap applies instead of the asset being refused.
 */
function findUsdc(cfg: IncentivConfig, asset: string, network: string) {
  return network === INCENTIV_NETWORK && asset.toLowerCase() === cfg.usdc.toLowerCase()
    ? { asset: cfg.usdc, decimals: USDC_DECIMALS, symbol: "USDC" }
    : undefined;
}

function checkCommon(x402Version: number, requirements: PaymentRequirements, scheme: string, cfg: IncentivConfig): number {
  if (x402Version !== 2) throw new Error(`${scheme} needs x402 v2, got v${x402Version}`);
  if (requirements.scheme !== scheme || requirements.network !== INCENTIV_NETWORK) {
    throw new Error(`Cannot pay ${requirements.scheme} on ${requirements.network}`);
  }
  if (requirements.asset.toLowerCase() !== cfg.usdc.toLowerCase()) throw new Error("Only Incentiv USDC payments are supported");
  if (!/^\d+$/.test(requirements.amount) || BigInt(requirements.amount) <= 0n) throw new Error("The 402 has no usable amount");
  const timeout = requirements.maxTimeoutSeconds;
  if (!Number.isInteger(timeout) || timeout <= 0) throw new Error("The 402 has no usable maxTimeoutSeconds");
  return timeout;
}

export interface IncentivEoaSigner {
  address: Address;
  signTransaction(tx: TransactionSerializableEIP1559): Promise<Hex>;
}

/** `incentiv-eoa-tx`: the standard wallet signs one USDC transfer and pays its own gas in CENT. */
export class IncentivEoaTxClientScheme implements SchemeNetworkClient {
  readonly scheme = INCENTIV_EOA_SCHEME;
  private readonly chain: Chain;

  findDefaultAsset(asset: string, network: string) {
    return findUsdc(this.cfg, asset, network);
  }

  constructor(private readonly signer: IncentivEoaSigner, private readonly cfg: IncentivConfig) {
    this.chain = makeChain(cfg);
  }

  async createPaymentPayload(x402Version: number, requirements: PaymentRequirements) {
    const timeout = checkCommon(x402Version, requirements, this.scheme, this.cfg);
    const from = this.signer.address;
    const asset = getAddress(requirements.asset);
    const call = transferCall(asset, getAddress(requirements.payTo), BigInt(requirements.amount));
    const [nonce, pending, estimate, block] = await Promise.all([
      this.chain.client.getTransactionCount({ address: from, blockTag: "latest" }),
      this.chain.client.getTransactionCount({ address: from, blockTag: "pending" }),
      this.chain.client.estimateGas({ account: from, to: asset, data: call.data }),
      this.chain.client.getBlock(),
    ]);
    // The facilitator accepts only the next confirmed nonce.
    if (pending !== nonce) {
      throw new Error(`${from} has ${pending - nonce} pending transaction(s) on Incentiv; wait until they are mined before paying`);
    }
    const gas = (estimate * 120n) / 100n;
    if (gas > MAX_EOA_GAS) throw new Error(`The transfer needs ${gas} gas, above the ${MAX_EOA_GAS} the facilitator accepts`);
    const tip = 1_000_000_000n;
    const validUntil = Math.floor(Date.now() / 1000) + timeout;

    const signedTransaction = await this.signer.signTransaction({
      type: "eip1559",
      chainId: this.cfg.chainId,
      to: asset,
      value: 0n,
      data: call.data,
      nonce,
      gas,
      maxFeePerGas: ((block.baseFeePerGas ?? 12_600_000_000_000n) * 13n) / 10n + tip,
      maxPriorityFeePerGas: tip,
      accessList: [{ address: deadlineMarker(validUntil), storageKeys: [] }],
    });

    // Never send what was not asked for: decode what was signed and compare it with the 402.
    try {
      checkPaysRequirements(decodeEoaPayment(signedTransaction, this.cfg.chainId), requirements);
    } catch (e) {
      if (e instanceof IncentivPaymentError) throw new Error(`Refusing to send: ${e.message}`);
      throw e;
    }
    return { x402Version, payload: { signedTransaction } };
  }
}

export interface IncentivOwnerSigner {
  address: Address;
  signMessage(args: { message: { raw: Hex } }): Promise<Hex>;
}

export interface IncentivUserOpOptions {
  /** "token" pays gas in USDC through the paymaster; "native" pays it in CENT from the smart account. */
  gas: "token" | "native";
  /** CREATE2 salt of the smart account. Default 0. */
  salt?: bigint;
  /** Most USDC (atomic units) paid to the paymaster for gas on one payment. Default 0.25 USDC. */
  maxGasFee?: bigint;
  /** Most CENT (wei) one payment may reserve for gas with gas "native". Default 100 CENT. */
  maxNativeGasCost?: bigint;
}

function randomPaymentId(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** `incentiv-userop`: the owner key signs an ERC-4337 operation paid from its Incentiv smart account. */
export class IncentivUserOpClientScheme implements SchemeNetworkClient {
  readonly scheme = INCENTIV_USEROP_SCHEME;
  private readonly chain: Chain;

  findDefaultAsset(asset: string, network: string) {
    return findUsdc(this.cfg, asset, network);
  }

  constructor(
    private readonly owner: IncentivOwnerSigner,
    private readonly options: IncentivUserOpOptions,
    private readonly cfg: IncentivConfig,
  ) {
    this.chain = makeChain(cfg);
  }

  /** The smart account this owner pays from. */
  account(): Promise<Address> {
    return smartAccountAddress(this.chain, this.owner.address, this.options.salt ?? 0n);
  }

  async createPaymentPayload(x402Version: number, requirements: PaymentRequirements) {
    const timeout = checkCommon(x402Version, requirements, this.scheme, this.cfg);
    const entryPoint = requirements.extra?.entryPoint;
    if (typeof entryPoint !== "string" || !isAddressEqual(entryPoint as Address, this.cfg.entryPoint)) {
      throw new Error("The 402 names an EntryPoint this client does not trust");
    }

    const paymentId = randomPaymentId();
    const validUntil = Math.floor(Date.now() / 1000) + timeout;
    const account = await this.account();
    const prepared = await preparePayment(this.chain, {
      account,
      owner: this.owner.address,
      salt: this.options.salt,
      asset: getAddress(requirements.asset),
      payTo: getAddress(requirements.payTo),
      amount: BigInt(requirements.amount),
      paymentId,
      validUntil,
      gas: this.options.gas,
    });

    // Never sign what was not asked for: decode what is about to be signed and compare it with the 402.
    let decoded;
    try {
      decoded = decodePaymentOp(prepared.op, this.cfg);
      checkPaysRequirements(decoded, requirements);
    } catch (e) {
      if (e instanceof IncentivPaymentError) throw new Error(`Refusing to sign: ${e.message}`);
      throw e;
    }
    // The gas transfer to the paymaster is not refunded, so a bad estimate or quote must not set it unchecked.
    const maxGasFee = this.options.maxGasFee ?? DEFAULT_MAX_GAS_FEE;
    if (decoded.gasFee !== undefined && decoded.gasFee > maxGasFee) {
      throw new Error(`Refusing to sign: the gas fee is ${decoded.gasFee} USDC atomic units, above maxGasFee (${maxGasFee})`);
    }
    const maxNative = this.options.maxNativeGasCost ?? DEFAULT_MAX_NATIVE_GAS_COST;
    if (!prepared.op.paymaster && requiredPrefund(prepared.op) > maxNative) {
      throw new Error(`Refusing to sign: the operation may cost up to ${requiredPrefund(prepared.op)} wei of CENT for gas, above maxNativeGasCost (${maxNative})`);
    }

    // The account verifies an EIP-191 signature over the raw operation hash.
    const signature = await this.owner.signMessage({ message: { raw: prepared.userOpHash } });
    const payload = { userOperation: opToWire({ ...prepared.op, signature }), userOpHash: prepared.userOpHash, paymentId, validUntil };
    return { x402Version, payload };
  }
}
