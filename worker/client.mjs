// Agent client: run from the worker directory. Never print or commit AGENT_KEY.
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { NETWORK, USDC } from "./payments.mjs";
const base = process.env.PROOFRUN_API_URL;
if (!base || !process.env.AGENT_KEY)
  throw Error("Set PROOFRUN_API_URL and AGENT_KEY.");
const target = process.argv[2];
if (!target)
  throw Error(
    "Usage: node --env-file=.agent.env client.mjs https://your-app.com",
  );
const stateFile = process.env.RUN_STATE_FILE || ".agent-run.json";
let run;
try {
  run = JSON.parse(await readFile(stateFile, "utf8"));
  if (run.url !== target)
    throw Error(
      "Saved run belongs to another URL. Set a different RUN_STATE_FILE.",
    );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  const response = await fetch(base + "/v1/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: target,
      check: "load",
      idempotencyKey: randomUUID(),
    }),
  });
  run = await response.json();
  if (!response.ok) throw Error(run.error);
  await writeFile(stateFile, JSON.stringify(run, null, 2), { mode: 0o600 });
}
const signer = privateKeyToAccount(process.env.AGENT_KEY);
const client = new x402Client().register(NETWORK, new ExactEvmScheme(signer));
client.onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
  if (
    r.network !== NETWORK ||
    r.asset.toLowerCase() !== USDC.toLowerCase() ||
    BigInt(r.amount) > BigInt(process.env.MAX_PRICE_ATOMIC || "100000")
  )
    return {
      abort: true,
      reason: "Payment exceeds the approved network, asset, or budget.",
    };
});
const pay = wrapFetchWithPayment(fetch, client);
const auth = { Authorization: "Bearer " + run.accessToken };
let response = await pay(base + "/v1/runs/" + run.id + "/execute", {
  method: "POST",
  headers: auth,
});
let result = await response.json();
if (!response.ok) throw Error(result.error);
for (
  let i = 0;
  i < 60 && ["queued", "running", "settling"].includes(result.status);
  i++
) {
  await new Promise((r) => setTimeout(r, 2000));
  response = await fetch(base + "/v1/runs/" + run.id, { headers: auth });
  result = await response.json();
  if (!response.ok) throw Error(result.error);
}
console.log(JSON.stringify(result, null, 2));
if (result.status !== "completed") process.exitCode = 2;
