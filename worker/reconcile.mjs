// Run on the worker host with the worker stopped. Validates the exact on-chain
// USDC authorization nonce and transfer before enabling a free execution retry.
import { createPublicClient, http, parseEventLogs, parseAbi } from "viem";
import { avalancheFuji } from "viem/chains";
import { createStore } from "./store.mjs";
import { USDC, isFujiQuote } from "./payments.mjs";
import network from "./network.json" with { type: "json" };
const [id, hash] = process.argv.slice(2);
if (!id || !/^0x[0-9a-fA-F]{64}$/.test(hash || ""))
  throw Error(
    "Usage: node --env-file=.env reconcile.mjs RUN_ID TRANSACTION_HASH",
  );
const s = createStore(process.env.DATA_DIR || "./data");
try {
  const r = s.get(id);
  if (!r || r.status !== "settlement_unknown" || !r.payment)
    throw Error("Run does not need reconciliation");
  const p = JSON.parse(r.payment),
    q = JSON.parse(r.requirements);
  if (!isFujiQuote(q)) throw Error("Saved payment is not for Fuji testnet.");
  const client = createPublicClient({
    chain: avalancheFuji,
    transport: http(
      process.env.AVALANCHE_RPC_URL || network.rpcUrl,
    ),
  });
  if (await client.getChainId() !== network.chainId)
    throw Error("RPC must connect to Avalanche Fuji (43113).");
  const receipt = await client.getTransactionReceipt({ hash });
  if (receipt.status !== "success") throw Error("Transaction failed");
  const logs = parseEventLogs({
    abi: parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 value)",
      "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
    ]),
    logs: receipt.logs.filter(
      (l) => l.address.toLowerCase() === USDC.toLowerCase(),
    ),
    strict: false,
  });
  const transfer = logs.some(
    (l) =>
      l.eventName === "Transfer" &&
      l.args.from?.toLowerCase() ===
        p.payload.authorization.from.toLowerCase() &&
      l.args.to?.toLowerCase() === q.payTo.toLowerCase() &&
      l.args.value === BigInt(q.amount),
  );
  const authorization = logs.some(
    (l) =>
      l.eventName === "AuthorizationUsed" &&
      l.args.authorizer?.toLowerCase() ===
        p.payload.authorization.from.toLowerCase() &&
      l.args.nonce?.toLowerCase() ===
        p.payload.authorization.nonce.toLowerCase(),
  );
  if (!transfer || !authorization)
    throw Error("Transaction does not prove payment for this authorization.");
  s.update(id, {
    tx: hash,
    status: "failed",
    error: "Payment reconciled. Retry execution without another payment.",
  });
  console.log("Payment verified; free execution retry enabled.");
} finally {
  s.close();
}
