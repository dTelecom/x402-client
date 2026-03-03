import { DtelecomGateway } from "@dtelecom/x402-client";
import { privateKeyToAccount } from "viem/accounts";
import * as fs from "node:fs";
import * as path from "node:path";

const GATEWAY_URL = "https://x402.dtelecom.org";

async function main() {
  const keyFile = path.join(import.meta.dirname, ".wallet-key");
  if (!fs.existsSync(keyFile)) {
    console.error("No wallet key found. Run 'npm test' first to generate one.");
    process.exit(1);
  }

  const privateKey = fs.readFileSync(keyFile, "utf-8").trim() as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  console.log(`Wallet: ${account.address}`);

  const gateway = new DtelecomGateway({
    gatewayUrl: GATEWAY_URL,
    account,
  });

  const amount = Number(process.argv[2] || "0.10");
  console.log(`Buying $${amount.toFixed(2)} in credits...`);

  const result = await gateway.buyCredits({ amountUsd: amount });
  console.log(`Credited: ${result.creditedMicrocredits} microcredits`);

  const acct = await gateway.getAccount();
  console.log(`Balance: ${acct.creditBalance} microcredits (available: ${acct.availableBalance})`);
}

main().catch(console.error);
