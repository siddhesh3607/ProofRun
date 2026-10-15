import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isPublicAddress, validateTarget } from "../security.mjs";
import { createApp } from "../server.mjs";
import { NETWORK, USDC, decodePayment, isFujiQuote } from "../payments.mjs";

test("Fuji payments reject mainnet and other token authorizations", () => {
  assert.equal(NETWORK, "eip155:43113");
  assert.equal(USDC, "0x5425890298aed601595a70AB815c96711a31Bc65");
  const accepted = { network: NETWORK, scheme: "exact", asset: USDC };
  const encode = (q) => Buffer.from(JSON.stringify({
    x402Version: 2, accepted: q,
    payload: { authorization: { from: "0x" + "2".repeat(40), nonce: "0x" + "a".repeat(64) } },
  })).toString("base64");
  assert.ok(isFujiQuote(accepted));
  assert.equal(decodePayment(encode(accepted)).accepted.network, NETWORK);
  assert.throws(() => decodePayment(encode({ ...accepted, network: "eip155:43114" })));
  assert.throws(() => decodePayment(encode({ ...accepted, asset: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" })));
});
test("egress policy rejects private, mapped, link-local, multicast and encoded loopback destinations", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "224.0.0.1",
    "100.64.0.1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  for (const u of [
    "http://2130706433",
    "http://0x7f000001",
    "http://localhost",
    "http://a.local",
    "file:///etc/passwd",
    "http://user:pass@example.com",
    "https://example.com:8080",
  ])
    assert.throws(() => validateTarget(u), u);
});
test("malformed x402 data is rejected", () => {
  for (const value of ["", "not-json", Buffer.from("{}").toString("base64")])
    assert.throws(() => decodePayment(value));
});
async function setup(t, { uncertain = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "proofrun-test-"));
  let charges = 0,
    executions = 0;
  const requirements = {
    scheme: "exact",
    network: NETWORK,
    amount: "100000",
    asset: USDC,
    payTo: "0x" + "1".repeat(40),
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  };
  const service = await createApp(
    { dataDir: dir, secret: "test-only-secret-".repeat(4) },
    {
      payments: {
        requirements,
        verify: async (p) => ({ isValid: p.payload.signature === "valid" }),
        settle: async () => {
          charges++;
          await new Promise((r) => setTimeout(r, 20));
          if (uncertain) throw Error("timeout");
          return {
            success: true,
            transaction: "0x" + String(charges).padStart(64, "0"),
            network: NETWORK,
          };
        },
      },
      runner: async () => {
        executions++;
        return {
          checks: [
            {
              name: "Page loads",
              passed: true,
              expected: "HTTP 200",
              observed: "HTTP 200",
            },
          ],
          console: [],
          durationMs: 2,
        };
      },
    },
  );
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    service.close();
    await rm(dir, { recursive: true, force: true });
  });
  const create = async (key = randomUUID()) => {
    const r = await fetch(base + "/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://1.1.1.1", idempotencyKey: key }),
    });
    assert.ok(r.ok);
    return r.json();
  };
  const execute = (run, signature = "valid", nonce = "a".repeat(64)) =>
    fetch(base + "/v1/runs/" + run.id + "/execute", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + run.accessToken,
        "PAYMENT-SIGNATURE": Buffer.from(
          JSON.stringify({
            x402Version: 2,
            accepted: requirements,
            payload: {
              signature,
              authorization: {
                from: "0x" + "2".repeat(40),
                nonce: "0x" + nonce,
              },
            },
          }),
        ).toString("base64"),
      },
    });
  return {
    base,
    create,
    execute,
    service,
    get charges() {
      return charges;
    },
    get executions() {
      return executions;
    },
  };
}
test("run access, 402, idempotent creation and concurrent settlement", async (t) => {
  const s = await setup(t);
  const key = randomUUID();
  const r = await s.create(key);
  assert.equal((await s.create(key)).id, r.id);
  assert.equal((await fetch(s.base + "/v1/runs/" + r.id)).status, 404);
  assert.equal(
    (
      await fetch(s.base + "/v1/runs/" + r.id + "/execute", {
        method: "POST",
        headers: { Authorization: "Bearer " + r.accessToken },
      })
    ).status,
    402,
  );
  assert.equal((await s.execute(r, "bad")).status, 402);
  assert.equal(s.charges, 0);
  await Promise.all([s.execute(r), s.execute(r)]);
  assert.equal(s.charges, 1);
  assert.equal(s.executions, 1);
  await s.execute(r);
  assert.equal(s.charges, 1);
  const result = await fetch(s.base + "/v1/runs/" + r.id, {
    headers: { Authorization: "Bearer " + r.accessToken },
  }).then((r) => r.json());
  assert.equal(result.status, "completed");
  assert.equal(result.network, "eip155:43113");
  assert.equal(result.result.checks[0].passed, true);
  const other = await s.create();
  assert.equal((await s.execute(other)).status, 409);
  assert.equal(s.charges, 1);
});
test("uncertain settlement never automatically charges again", async (t) => {
  const s = await setup(t, { uncertain: true });
  const r = await s.create();
  await s.execute(r);
  const result = await s.execute(r);
  assert.equal((await result.json()).status, "settlement_unknown");
  assert.equal(s.charges, 1);
  assert.equal(s.executions, 0);
});

test("a saved mainnet quote cannot be challenged or settled after the Fuji switch", async (t) => {
  const s = await setup(t);
  const run = await s.create();
  const old = JSON.parse(s.service.store.get(run.id).requirements);
  old.network = "eip155:43114";
  old.asset = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
  s.service.store.db.prepare("UPDATE runs SET requirements=? WHERE id=?").run(JSON.stringify(old), run.id);
  const response = await s.execute(run);
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("payment-required"), null);
  assert.equal(s.charges, 0);
  assert.equal(s.executions, 0);
});
test("demo and listing require dashboard authentication", async (t) => {
  const s = await setup(t);
  assert.equal(
    (await fetch(s.base + "/v1/demo", { method: "POST" })).status,
    401,
  );
  assert.equal((await fetch(s.base + "/v1/runs")).status, 401);
});
