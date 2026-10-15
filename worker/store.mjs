import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
export function createStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "proofrun.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, idem TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, token_hash TEXT NOT NULL, status TEXT NOT NULL, input TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, price TEXT NOT NULL, requirements TEXT, payment TEXT, nonce TEXT UNIQUE, tx TEXT UNIQUE, result TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS runs_owner_created ON runs(owner,created_at DESC);",
  );
  // A crashed browser may be retried for free. Settling runs are deliberately not
  // retried automatically: settlement may have succeeded before the process died.
  db.prepare(
    "UPDATE runs SET status='failed',error='Browser worker restarted. Retry execution without paying again.' WHERE status IN ('running','queued')",
  ).run();
  db.prepare(
    "UPDATE runs SET status='settlement_unknown',error='Payment outcome needs operator reconciliation. Do not pay again.' WHERE status='settling'",
  ).run();
  return {
    db,
    get: (id) => db.prepare("SELECT * FROM runs WHERE id=?").get(id),
    byKey: (key) => db.prepare("SELECT * FROM runs WHERE idem=?").get(key),
    list: (owner) =>
      db
        .prepare(
          "SELECT * FROM runs WHERE owner=? ORDER BY created_at DESC LIMIT 100",
        )
        .all(owner),
    update(id, fields) {
      const allowed = [
        "status",
        "payment",
        "nonce",
        "tx",
        "result",
        "error",
        "attempts",
      ];
      const entries = Object.entries(fields);
      if (entries.some(([k]) => !allowed.includes(k)))
        throw Error("Invalid field");
      db.prepare(
        "UPDATE runs SET " +
          entries.map(([k]) => k + "=?").join(",") +
          " WHERE id=?",
      ).run(...entries.map(([, v]) => v), id);
    },
    close: () => db.close(),
  };
}
export function publicRun(r) {
  return {
    id: r.id,
    url: JSON.parse(r.input).url,
    status: r.status,
    createdAt: r.created_at,
    demo: !!r.demo,
    price: r.price,
    transaction: r.tx || undefined,
    network: r.requirements ? JSON.parse(r.requirements).network : undefined,
    result: r.result ? JSON.parse(r.result) : undefined,
    error: r.error || undefined,
  };
}
