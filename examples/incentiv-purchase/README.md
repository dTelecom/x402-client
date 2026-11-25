# Incentiv purchase example

Buy dTelecom gateway credits with USDC on Incentiv Mainnet. Run with Node 22 after `npm run build` in `x402-client`. Use a dedicated test wallet.

| `WALLET` | Who pays | Fund on Incentiv |
|----------|----------|------------------|
| `eoa` (default) | The key's standard wallet | USDC + a little CENT for gas |
| `smart-usdc` | The key's Incentiv smart account; gas paid in USDC to the paymaster | USDC (purchase + gas fee) |
| `smart-cent` | The same smart account; gas paid in CENT | USDC + CENT |

```sh
# 1. Which address to fund (the smart account address is known before it is deployed)
WALLET_PRIVATE_KEY=0x… WALLET=smart-usdc node examples/incentiv-purchase/purchase.mjs address
# 2. Check funding
WALLET_PRIVATE_KEY=0x… WALLET=smart-usdc node examples/incentiv-purchase/purchase.mjs balances
# 3. Buy credits (spends real funds)
WALLET_PRIVATE_KEY=0x… WALLET=smart-usdc GATEWAY_ORIGIN=https://x402.dtelecom.org AMOUNT_USD=0.1 \
  node examples/incentiv-purchase/purchase.mjs buy
```

Credits always go to the key's own address (`gatewayAccount`), whichever wallet type pays.
