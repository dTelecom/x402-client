// Buy gateway credits with USDC on Incentiv. Run with Node 22 after `npm run build` in x402-client.
//
//   WALLET_PRIVATE_KEY=0x… WALLET=eoa node examples/incentiv-purchase/purchase.mjs address
//   WALLET_PRIVATE_KEY=0x… WALLET=eoa node examples/incentiv-purchase/purchase.mjs balances
//   WALLET_PRIVATE_KEY=0x… WALLET=eoa GATEWAY_ORIGIN=https://x402.dtelecom.org AMOUNT_USD=0.1 \
//     node examples/incentiv-purchase/purchase.mjs buy
//
// WALLET: eoa (default) | smart-usdc | smart-cent. `buy` spends real USDC (plus gas) on Incentiv Mainnet.
import { privateKeyToAccount } from "viem/accounts";
import { DtelecomGateway } from "../../dist/index.mjs";
import { incentivBalances, incentivPaymentAddress, incentivRail } from "../../dist/incentiv.mjs";

const key = process.env.WALLET_PRIVATE_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) throw new Error("Set WALLET_PRIVATE_KEY to a 0x-prefixed private key");
const account = privateKeyToAccount(key);
const wallet = process.env.WALLET ?? "eoa";
const command = process.argv[2] ?? "address";

const payer = await incentivPaymentAddress(account.address, { wallet });
if (command === "address") {
  console.log(JSON.stringify({ wallet, gatewayAccount: account.address, fundOnIncentiv: payer }, null, 2));
} else if (command === "balances") {
  const { usdc, cent } = await incentivBalances(payer);
  console.log(JSON.stringify({ wallet, address: payer, usdc: Number(usdc) / 1e6, cent: Number(cent) / 1e18 }, null, 2));
} else if (command === "buy") {
  const gatewayUrl = process.env.GATEWAY_ORIGIN;
  if (!gatewayUrl) throw new Error("Set GATEWAY_ORIGIN, e.g. https://x402.dtelecom.org");
  const amountUsd = Number(process.env.AMOUNT_USD ?? "0.1");
  const gateway = new DtelecomGateway({ account, gatewayUrl, paymentRail: incentivRail({ wallet }) });
  console.log(JSON.stringify(await gateway.buyCredits({ amountUsd }), null, 2));
  console.log(JSON.stringify(await gateway.getAccount(), null, 2));
} else {
  throw new Error("Usage: purchase.mjs address | balances | buy");
}
