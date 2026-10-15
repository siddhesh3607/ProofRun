import express from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, publicRun } from "./store.mjs";
import { runBrowser } from "./browser.mjs";
import { validateTarget, resolvePublic } from "./security.mjs";
import {
  createPayments,
  decodePayment,
  challenge,
  NETWORK,
} from "./payments.mjs";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const schema = z
  .object({
    url: z.string().url().max(2000),
    check: z.enum(["load", "navigate", "validation"]).default("load"),
    selector: z.string().max(200).default(""),
    expected: z.string().max(500).default(""),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.check !== "load" && (!v.selector || !v.expected))
      c.addIssue({
        code: "custom",
        message: "Selector and expected result are required",
      });
  });
export async function createApp(config = {}, injected = {}) {
  const dataDir = path.resolve(
    config.dataDir || process.env.DATA_DIR || "./data",
  );
  const secret = config.secret || process.env.SERVICE_TOKEN;
  if (!secret || secret.length < 32)
    throw Error(
      "SERVICE_TOKEN must be a persistent random secret of at least 32 characters.",
    );
  const origin =
    config.origin || process.env.PUBLIC_API_URL || "http://localhost:4021";
  const amount = process.env.PRICE_ATOMIC || "100000";
  if (!/^[1-9][0-9]{0,6}$/.test(amount))
    throw Error("PRICE_ATOMIC must be 1 to 9999999 USDC atomic units.");
  const price = (Number(amount) / 1e6)
    .toFixed(6)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  const store = createStore(dataDir);
  let payments = null,
    paymentError = "";
  try {
    payments =
      injected.payments === undefined
        ? await createPayments({
            payTo: process.env.PAY_TO,
            facilitator: process.env.FACILITATOR_URL,
            facilitatorToken: process.env.FACILITATOR_TOKEN,
            amount,
          })
        : injected.payments;
  } catch (e) {
    paymentError = e.message;
    console.error("Payments disabled:", paymentError);
  }
  const runner = injected.runner || runBrowser;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  app.use(
    "/v1",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  const createLimit = rateLimit({
    windowMs: 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const service = (req) => same(req.get("x-service-token"), secret);
  const owner = (req) =>
    service(req) && /^[a-f0-9]{64}$/.test(req.get("x-owner") || "")
      ? req.get("x-owner")
      : null;
  const access = (req, row) =>
    !!row &&
    ((owner(req) && row.owner === owner(req)) ||
      same(
        sha((req.get("authorization") || "").replace(/^Bearer /, "")),
        row.token_hash,
      ));
  const requireRun = (req, res, next) => {
    const r = store.get(req.params.id);
    if (!access(req, r))
      return res.status(404).json({ error: "Run not found" });
    req.run = r;
    next();
  };
  const queue = [];
  let working = false;
  async function drain() {
    if (working) return;
    working = true;
    while (queue.length) {
      const id = queue.shift();
      const r = store.get(id);
      try {
        store.update(id, {
          status: "running",
          attempts: r.attempts + 1,
          error: null,
        });
        const result = await runner(
          JSON.parse(r.input),
          path.join(dataDir, id),
          { demo: !!r.demo },
        );
        store.update(id, {
          status: "completed",
          result: JSON.stringify(result),
        });
      } catch (e) {
        console.error("Browser run failed", id, e.message);
        store.update(id, {
          status: "failed",
          error:
            "Browser service could not finish this run. Retry execution once without paying again.",
        });
      }
    }
    working = false;
  }
  function enqueue(id) {
    store.update(id, { status: "queued" });
    queue.push(id);
    void drain();
  }
  app.get("/health", (_req, res) =>
    res.json({
      connected: true,
      paymentsReady: !!payments,
      price,
      network: NETWORK,
      worker: "ProofRun",
      paymentStatus: payments
        ? "ready"
        : paymentError
          ? "facilitator_unavailable"
          : "configuration_required",
    }),
  );
  app.get("/v1/runs", (req, res) => {
    const o = owner(req);
    if (!o)
      return res
        .status(401)
        .json({ error: "Dashboard authentication required" });
    res.json({ runs: store.list(o).map(publicRun) });
  });
  app.post("/v1/runs", createLimit, async (req, res) => {
    if (!payments)
      return res
        .status(503)
        .json({ error: "Mainnet payments are not activated." });
    if (queue.length >= 12)
      return res
        .status(503)
        .json({ error: "Browser queue is full. Try again later." });
    const p = schema.safeParse(req.body);
    if (!p.success)
      return res
        .status(400)
        .json({ error: p.error.issues.map((i) => i.message).join("; ") });
    const { idempotencyKey, ...input } = p.data;
    try {
      validateTarget(input.url);
      await resolvePublic(new URL(input.url).hostname);
      if (input.check === "navigate") validateTarget(input.expected);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const token = createHmac("sha256", secret)
      .update("run:" + idempotencyKey)
      .digest("hex");
    const fingerprint = sha(JSON.stringify(input));
    let row = store.byKey(idempotencyKey);
    if (row) {
      if (
        row.fingerprint !== fingerprint ||
        row.owner !== (owner(req) || sha(token))
      )
        return res
          .status(409)
          .json({
            error: "Idempotency key is already used for a different request.",
          });
      return res.json({ ...publicRun(row), accessToken: token });
    }
    const id = randomUUID();
    store.db
      .prepare(
        "INSERT INTO runs (id,owner,idem,fingerprint,token_hash,status,input,price,requirements,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        owner(req) || sha(token),
        idempotencyKey,
        fingerprint,
        sha(token),
        "awaiting_payment",
        JSON.stringify(input),
        price,
        JSON.stringify(payments.requirements),
        new Date().toISOString(),
      );
    res.status(201).json({ ...publicRun(store.get(id)), accessToken: token });
  });
  app.post("/v1/demo", createLimit, (req, res) => {
    if (!owner(req))
      return res
        .status(401)
        .json({ error: "Demo is available through the private dashboard." });
    if (queue.length >= 12)
      return res.status(503).json({ error: "Browser queue is full." });
    const id = randomUUID();
    const input = {
      url: "proofrun:fixture",
      check: "validation",
      selector: "button",
      expected: "Please enter your email",
    };
    store.db
      .prepare(
        "INSERT INTO runs (id,owner,idem,fingerprint,token_hash,status,input,demo,price,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        owner(req),
        randomUUID(),
        sha(JSON.stringify(input)),
        sha(randomUUID()),
        "queued",
        JSON.stringify(input),
        1,
        "0",
        new Date().toISOString(),
      );
    enqueue(id);
    res.status(202).json(publicRun(store.get(id)));
  });
  app.get("/v1/runs/:id", requireRun, (req, res) =>
    res.json(publicRun(req.run)),
  );
  app.get("/v1/runs/:id/screenshot", requireRun, (req, res) => {
    if (!req.run.result)
      return res.status(404).json({ error: "Screenshot is not ready." });
    res.type("png").sendFile(path.join(dataDir, req.run.id, "screenshot.png"));
  });
  app.post("/v1/runs/:id/execute", requireRun, async (req, res) => {
    const row = req.run;
    if (row.status !== "awaiting_payment")
      return res
        .status(
          ["settling", "queued", "running"].includes(row.status) ? 202 : 200,
        )
        .json(publicRun(row));
    if (!payments)
      return res
        .status(503)
        .json({ error: "Mainnet payments are not activated." });
    if (queue.length >= 12)
      return res
        .status(503)
        .json({ error: "Browser queue is full. No payment was attempted." });
    const required = challenge(row, origin);
    const header = req.get("payment-signature");
    if (!header)
      return res
        .set(
          "PAYMENT-REQUIRED",
          Buffer.from(JSON.stringify(required)).toString("base64"),
        )
        .status(402)
        .json(required);
    let payload;
    const requirements = JSON.parse(row.requirements);
    try {
      payload = decodePayment(header);
      const a = payload.accepted;
      if (
        a.amount !== requirements.amount ||
        a.asset?.toLowerCase() !== requirements.asset.toLowerCase() ||
        a.payTo?.toLowerCase() !== requirements.payTo.toLowerCase()
      )
        throw Error("Payment terms do not match the saved quote.");
      const result = await payments.verify(payload, requirements);
      if (!result.isValid)
        return res
          .status(402)
          .json({ error: "Payment authorization was rejected." });
    } catch {
      return res.status(400).json({ error: "Invalid payment authorization." });
    }
    const nonce =
      payload.payload.authorization.from.toLowerCase() +
      ":" +
      payload.payload.authorization.nonce.toLowerCase();
    try {
      const claimed = store.db
        .prepare(
          "UPDATE runs SET status='settling',payment=?,nonce=? WHERE id=? AND status='awaiting_payment'",
        )
        .run(JSON.stringify(payload), nonce, row.id);
      if (!claimed.changes)
        return res.status(202).json(publicRun(store.get(row.id)));
    } catch {
      return res
        .status(409)
        .json({
          error: "This payment authorization is already attached to a run.",
        });
    }
    try {
      const settled = await payments.settle(payload, requirements);
      if (!settled.success) {
        store.update(row.id, {
          status: "settlement_unknown",
          error:
            "Settlement was not confirmed. Operator reconciliation is required before another payment.",
        });
        return res.status(202).json(publicRun(store.get(row.id)));
      }
      if (
        settled.network !== NETWORK ||
        !/^0x[0-9a-fA-F]{64}$/.test(settled.transaction || "")
      )
        throw Error("Invalid settlement receipt");
      store.update(row.id, { tx: settled.transaction, status: "queued" });
      res.set(
        "PAYMENT-RESPONSE",
        Buffer.from(JSON.stringify(settled)).toString("base64"),
      );
      enqueue(row.id);
      return res.status(202).json(publicRun(store.get(row.id)));
    } catch (e) {
      console.error("Settlement needs reconciliation", row.id, e.message);
      store.update(row.id, {
        status: "settlement_unknown",
        error:
          "Payment outcome is uncertain. Do not pay again; request reconciliation for this run.",
      });
      return res.status(202).json(publicRun(store.get(row.id)));
    }
  });
  app.post("/v1/runs/:id/retry", requireRun, (req, res) => {
    const r = req.run;
    if (r.status !== "failed" || (!r.demo && !r.tx) || r.attempts >= 2)
      return res
        .status(409)
        .json({
          error:
            "This run cannot be retried. Contact the operator with your run ID.",
        });
    if (queue.length >= 12)
      return res.status(503).json({ error: "Browser queue is full." });
    enqueue(r.id);
    res.status(202).json(publicRun(store.get(r.id)));
  });
  // Reconciliation supplies a transaction hash; verify an on-chain USDC transfer
  // before calling this endpoint. Automated verification is in reconcile.mjs.
  app.post("/internal/reconcile/:id", (req, res) => {
    if (!service(req)) return res.sendStatus(401);
    const r = store.get(req.params.id);
    if (!r || r.status !== "settlement_unknown")
      return res
        .status(409)
        .json({ error: "Run is not awaiting reconciliation" });
    return res
      .status(409)
      .json({
        error:
          "Use the local reconcile.mjs command to verify the on-chain receipt.",
      });
  });
  app.use((err, req, res, next) => {
    console.error("Request failed:", err.message);
    if (!res.headersSent)
      res
        .status(err.type === "entity.too.large" ? 413 : 500)
        .json({ error: "Request could not be completed." });
  });
  return { app, store, close: () => store.close() };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const service = await createApp();
  const port = Number(process.env.PORT || 4021);
  service.app.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(
      "ProofRun worker ready at http://" +
        (process.env.HOST || "127.0.0.1") +
        ":" +
        port,
    ),
  );
}
