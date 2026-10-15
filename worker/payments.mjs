import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import network from "./network.json" with { type: "json" };
export const NETWORK = network.network;
export const USDC = network.usdc;
export function isFujiQuote(q) {
  return q?.network === NETWORK && q?.scheme === "exact" &&
    q?.asset?.toLowerCase() === USDC.toLowerCase();
}
export async function createPayments(config) {
  if (!config.payTo || !config.facilitator) return null;
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(config.payTo) ||
    /^0x0{40}$/.test(config.payTo)
  )
    throw Error("Invalid receiving address");
  if (new URL(config.facilitator).protocol !== "https:")
    throw Error("Facilitator must use HTTPS");
  const opts = { url: config.facilitator };
  if (config.facilitatorToken)
    opts.createAuthHeaders = async () => ({
      verify: { Authorization: "Bearer " + config.facilitatorToken },
      settle: { Authorization: "Bearer " + config.facilitatorToken },
      supported: { Authorization: "Bearer " + config.facilitatorToken },
    });
  const facilitator = new HTTPFacilitatorClient(opts);
  const server = new x402ResourceServer(facilitator).register(
    NETWORK,
    new ExactEvmScheme(),
  );
  await server.initialize();
  const requirements = await server.buildPaymentRequirements({
    scheme: "exact",
    network: NETWORK,
    payTo: config.payTo,
    price: {
      amount: config.amount,
      asset: USDC,
      extra: { name: "USD Coin", version: "2" },
    },
    maxTimeoutSeconds: 300,
  });
  if (!requirements.length || !isFujiQuote(requirements[0]))
    throw Error(
      "Facilitator does not support Avalanche Fuji testnet exact payments",
    );
  return {
    requirements: requirements[0],
    verify: (p, r) => server.verifyPayment(p, r),
    settle: (p, r) => server.settlePayment(p, r),
  };
}
export function challenge(run, origin) {
  return {
    x402Version: 2,
    resource: {
      url: origin + "/v1/runs/" + run.id + "/execute",
      description: "ProofRun browser verification",
      mimeType: "application/json",
    },
    accepts: [JSON.parse(run.requirements)],
  };
}
export function decodePayment(header) {
  if (!header || header.length > 20000) throw Error("Invalid payment header");
  const p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  if (
    !/^0x[0-9a-fA-F]{40}$/.test(p.payload?.authorization?.from || "") ||
    p.x402Version !== 2 ||
    !isFujiQuote(p.accepted) ||
    !/^0x[0-9a-fA-F]{64}$/.test(p.payload?.authorization?.nonce || "")
  )
    throw Error("Invalid x402 v2 exact payment");
  return p;
}
