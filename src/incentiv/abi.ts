// Ported from IncentivNetwork/incentiv-x402-public @ 4e3feeec41c88130100b25467c850e168dd771fe
// (src/abi.ts, client-side subset). Copyright (c) 2026 Incentiv, MIT License — see THIRD_PARTY_NOTICES.md.
import { parseAbi } from "viem";

export const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export const entryPointAbi = parseAbi([
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

export const accountFactoryAbi = parseAbi([
  "function getAddress(address owner, bytes32[2] publicKey, uint256 salt) view returns (address)",
  "function createAccount(address owner, bytes32[2] publicKey, uint256 salt) returns (address)",
]);

export const accountAbi = parseAbi([
  "function executeBatch(address[] dest, uint256[] value, bytes[] func)",
]);

export const quoterAbi = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "struct QuoteExactOutputSingleParams { address tokenIn; address tokenOut; uint256 amount; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactOutputSingle(QuoteExactOutputSingleParams params) view returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const paymasterAbi = parseAbi([
  "function gasEstimateCoefficient() view returns (uint256)",
  "function usdcToken() view returns (address)",
  "function usdcPoolFee() view returns (uint24)",
  "function minPaymentUsdc() view returns (uint256)",
  "function minTransactionGas() view returns (uint256)",
  "function maxVerificationGas() view returns (uint256)",
]);
