"use client";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Play,
  Terminal,
  FlaskConical,
  History,
  FileJson,
  Check,
  X,
  Globe,
  ChevronRight,
  Copy,
  Wallet,
  ShieldCheck,
  LoaderCircle,
  ExternalLink,
  Settings2,
  AlertTriangle,
} from "lucide-react";
type Run = {
  id: string;
  url: string;
  status: string;
  createdAt: string;
  demo: boolean;
  transaction?: string;
  price: string;
  result?: {
    checks: {
      name: string;
      passed: boolean;
      expected: string;
      observed: string;
    }[];
    console: string[];
    durationMs: number;
    screenshot?: string;
    finalUrl: string;
  };
  error?: string;
};
type Health = { connected: boolean; paymentsReady: boolean; price: string };
async function api<T = Run>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await fetch("/api/proofrun/" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const d = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(d.error || "The request could not be completed.");
  return d;
}
export default function Home() {
  const [view, setView] = useState("workspace"),
    [form, setForm] = useState({
      url: "",
      check: "load",
      selector: "",
      expected: "",
    }),
    [health, setHealth] = useState<Health | null>(null),
    [runs, setRuns] = useState<Run[]>([]),
    [active, setActive] = useState<Run | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [wallet, setWallet] = useState(""),
    [copied, setCopied] = useState(false);
  async function refresh() {
    try {
      const h = await api<Health>("health");
      setHealth(h);
      if (h.connected) setRuns((await api<{ runs: Run[] }>("runs")).runs);
    } catch {
      setHealth({ connected: false, paymentsReady: false, price: "0.10" });
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (!active || !["queued", "running", "settling"].includes(active.status))
      return;
    const t = setInterval(async () => {
      try {
        const r = await api("runs/" + active.id);
        setActive(r);
        if (!["queued", "running", "settling"].includes(r.status)) refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [active?.id, active?.status]);
  async function connect() {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("Install Core or MetaMask to pay for a run.");
    const a = await eth.request({ method: "eth_requestAccounts" });
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xa86a" }],
    });
    setWallet(a[0]);
    return eth;
  }
  async function pay(id: string) {
    const eth = await connect();
    const { createWalletClient, custom } = await import("viem");
    const { avalanche } = await import("viem/chains");
    const { x402Client, wrapFetchWithPayment } = await import("@x402/fetch");
    const { ExactEvmScheme } = await import("@x402/evm/exact/client");
    const a = await eth.request({ method: "eth_accounts" });
    const signer = createWalletClient({
      account: a[0],
      chain: avalanche,
      transport: custom(eth),
    });
    const c = new x402Client().register(
      "eip155:43114",
      new ExactEvmScheme({
        address: a[0],
        signTypedData: (msg) => signer.signTypedData(msg as any),
      }),
    );
    const r = await wrapFetchWithPayment(fetch, c)(
      "/api/proofrun/runs/" + id + "/execute",
      { method: "POST" },
    );
    const d = (await r.json()) as Run & { error?: string };
    if (!r.ok)
      throw new Error(
        d.error || "Payment did not complete. Your run is saved.",
      );
    setActive(d);
  }
  async function start(demo = false) {
    setBusy(true);
    setError("");
    try {
      if (demo) {
        setActive(await api("demo", { method: "POST", body: "{}" }));
      } else {
        const r = await api("runs", {
          method: "POST",
          body: JSON.stringify({
            ...form,
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        setActive(r);
        await pay(r.id);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      if (active.status === "failed") {
        setActive(
          await api("runs/" + active.id + "/retry", { method: "POST" }),
        );
      } else await pay(active.id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function select(r: Run) {
    setView("workspace");
    try {
      setActive(await api("runs/" + r.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function download() {
    if (!active) return;
    const u = URL.createObjectURL(
      new Blob([JSON.stringify(active, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = "proofrun-" + active.id + ".json";
    a.click();
    URL.revokeObjectURL(u);
  }
  const done = runs.filter((r) => r.status === "completed"),
    checks = active?.result?.checks || [];
  const example = [
    "import { x402Client, wrapFetchWithPayment } from '@x402/fetch';",
    "import { ExactEvmScheme } from '@x402/evm/exact/client';",
    "import { privateKeyToAccount } from 'viem/accounts';",
    "",
    "const client = new x402Client().register(",
    "  'eip155:43114',",
    "  new ExactEvmScheme(privateKeyToAccount(process.env.AGENT_KEY))",
    ");",
    "const pay = wrapFetchWithPayment(fetch, client);",
    "",
    "// Create a run and keep its access token private.",
    "const run = await fetch(API + '/v1/runs', {",
    "  method: 'POST',",
    "  headers: { 'Content-Type': 'application/json' },",
    "  body: JSON.stringify({ url: 'https://your-app.com',",
    "    check: 'load', idempotencyKey: crypto.randomUUID() })",
    "}).then(r => r.json());",
    "",
    "await pay(API + '/v1/runs/' + run.id + '/execute', {",
    "  method: 'POST',",
    "  headers: { Authorization: 'Bearer ' + run.accessToken }",
    "});",
    "",
    "// worker/client.mjs includes budget checks and polling.",
  ].join("\n");
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Check size={24} />
          </span>
          proofrun<span className="brand-period">.</span>
        </a>
        <div className="workspace-label">BUILD / VERIFY / SHIP</div>
        <nav>
          {[
            { id: "workspace", label: "Test workspace", icon: FlaskConical },
            { id: "history", label: "Run history", icon: History },
            { id: "api", label: "Agent API", icon: Terminal },
            { id: "settings", label: "Service setup", icon: Settings2 },
          ].map((n) => (
            <button
              key={n.id}
              title={n.label}
              className={"nav-item " + (view === n.id ? "selected" : "")}
              onClick={() => setView(n.id)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
              {view === n.id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="network-mark">
            ▲ <span>Avalanche C-Chain</span>
          </div>
          <p>Mainnet · USDC · x402</p>
          <span
            className={"pill " + (health?.paymentsReady ? "green" : "amber")}
          >
            {health?.paymentsReady
              ? "Payments enabled"
              : "Payments not activated"}
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            ProofRun <span className="slash">/</span>{" "}
            {view === "workspace"
              ? "Test workspace"
              : view === "history"
                ? "Run history"
                : view === "api"
                  ? "Agent API"
                  : "Service setup"}
          </span>
          <button
            className="wallet-button"
            onClick={() => connect().catch((e) => setError(e.message))}
          >
            <Wallet size={16} />
            {wallet
              ? wallet.slice(0, 6) + "…" + wallet.slice(-4)
              : "Connect wallet"}
          </button>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "workspace"
                  ? "BROWSER VERIFICATION"
                  : view === "history"
                    ? "YOUR EVIDENCE TRAIL"
                    : view === "api"
                      ? "BUILT FOR AGENTS"
                      : "CONFIGURATION"}
              </div>
              <h1>
                {view === "workspace"
                  ? "Ship with evidence."
                  : view === "history"
                    ? "Every run. Every result."
                    : view === "api"
                      ? "One request. Real evidence."
                      : "Ready for the real world."}
              </h1>
              <p>
                {view === "workspace"
                  ? "Run a real browser check. Get a report your agent can act on."
                  : view === "history"
                    ? "Reopen saved reports without paying for another run."
                    : view === "api"
                      ? "Let your coding agent purchase browser checks with x402."
                      : "Connect browser execution and mainnet settlement."}
              </p>
            </div>
            <span className="protocol-tag">
              x402 <span>PAY PER RUN</span>
            </span>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {view === "workspace" && (
            <>
              <div className="stats">
                <div>
                  <span>Completed runs</span>
                  <strong>{String(done.length).padStart(2, "0")}</strong>
                </div>
                <div>
                  <span>Successful checks</span>
                  <strong>
                    {String(
                      done.reduce(
                        (n, r) =>
                          n +
                          (r.result?.checks.filter((c) => c.passed).length ||
                            0),
                        0,
                      ),
                    ).padStart(2, "0")}
                  </strong>
                </div>
                <div>
                  <span>Price per run</span>
                  <strong>
                    {health?.price || "0.10"}
                    <small> USDC</small>
                  </strong>
                </div>
                <div>
                  <span>Settlement network</span>
                  <strong className="network-stat">
                    ▲ Avalanche<small>C-Chain mainnet</small>
                  </strong>
                </div>
              </div>
              <div className="work-grid">
                <section className="panel test-panel">
                  <div className="panel-title">
                    <span className="number">01</span>
                    <h2>Configure your test</h2>
                    <FlaskConical size={19} />
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      start();
                    }}
                  >
                    <label htmlFor="url">Website URL</label>
                    <div className="input-icon">
                      <Globe size={17} />
                      <input
                        id="url"
                        type="url"
                        placeholder="https://your-app.com"
                        required
                        maxLength={2000}
                        value={form.url}
                        onChange={(e) =>
                          setForm({ ...form, url: e.target.value })
                        }
                      />
                    </div>
                    <p className="field-note">
                      Public websites only. No credentials or private networks.
                    </p>
                    <label htmlFor="check">What should we verify?</label>
                    <select
                      id="check"
                      value={form.check}
                      onChange={(e) =>
                        setForm({ ...form, check: e.target.value })
                      }
                    >
                      <option value="load">Page loads successfully</option>
                      <option value="navigate">
                        Button opens the expected page
                      </option>
                      <option value="validation">
                        Form displays a validation message
                      </option>
                    </select>
                    {form.check !== "load" && (
                      <>
                        <label htmlFor="selector">Button CSS selector</label>
                        <input
                          id="selector"
                          placeholder='button[type="submit"]'
                          required
                          maxLength={200}
                          value={form.selector}
                          onChange={(e) =>
                            setForm({ ...form, selector: e.target.value })
                          }
                        />
                        <label htmlFor="expected">
                          {form.check === "navigate"
                            ? "Expected destination URL"
                            : "Expected visible error message"}
                        </label>
                        <input
                          id="expected"
                          required
                          maxLength={500}
                          placeholder={
                            form.check === "navigate"
                              ? "https://your-app.com/signup"
                              : "Please enter your email"
                          }
                          value={form.expected}
                          onChange={(e) =>
                            setForm({ ...form, expected: e.target.value })
                          }
                        />
                      </>
                    )}
                    <div className="included">
                      <ShieldCheck size={18} />
                      <div>
                        <strong>Evidence included</strong>
                        <span>Screenshot · Console errors · JSON report</span>
                      </div>
                    </div>
                    <div className="price-row">
                      <span>One browser run</span>
                      <strong>{health?.price || "0.10"} USDC</strong>
                    </div>
                    <button
                      className="primary"
                      disabled={busy || !health?.paymentsReady}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Play size={17} />
                      )}
                      Pay & run test <ArrowUpRight size={17} />
                    </button>
                    {!health?.paymentsReady && (
                      <p className="activation-note">
                        Mainnet payments are not activated yet.
                      </p>
                    )}
                    <button
                      type="button"
                      className="demo-button"
                      disabled={busy || !health?.connected}
                      onClick={() => start(true)}
                    >
                      Try the built-in demo <ChevronRight size={16} />
                    </button>
                    <p className="field-note centered">
                      A real browser run on our test fixture. No payment.
                    </p>
                  </form>
                </section>
                <section className="panel result-panel">
                  <div className="panel-title">
                    <span className="number">02</span>
                    <h2>Inspect the evidence</h2>
                    {active && (
                      <button
                        className="icon-button"
                        title="Download JSON report"
                        onClick={download}
                      >
                        <FileJson size={18} />
                      </button>
                    )}
                  </div>
                  {!active ? (
                    <div className="empty-result">
                      <div className="evidence-icon">
                        <Terminal size={30} />
                        <span>
                          <Check size={14} />
                        </span>
                      </div>
                      <h3>Your next run starts here.</h3>
                      <p>
                        Run a check to see what passed,
                        <br />
                        what failed, and the evidence behind it.
                      </p>
                      <div className="terminal-preview">
                        <span>$ proofrun verify your-app.com</span>
                        <div>▎ Waiting for your first run</div>
                      </div>
                      {health && !health.connected && (
                        <div className="setup-callout">
                          <strong>Browser service needs connecting</strong>
                          <p>Connect the browser worker to start testing.</p>
                          <button onClick={() => setView("settings")}>
                            View setup <ArrowUpRight size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="report">
                      <div className="report-heading">
                        <span
                          className={
                            "pill " +
                            (active.status === "completed"
                              ? "green"
                              : active.status === "failed"
                                ? "red"
                                : "amber")
                          }
                        >
                          {active.status.replaceAll("_", " ")}
                        </span>
                        {active.demo && (
                          <span className="pill">DEMO · NO PAYMENT</span>
                        )}
                        <span className="mono">{active.id.slice(0, 8)}</span>
                      </div>
                      <h3>
                        {active.demo ? "ProofRun test fixture" : active.url}
                      </h3>
                      {["queued", "running", "settling"].includes(
                        active.status,
                      ) && (
                        <div className="running-state">
                          <LoaderCircle className="spin" size={22} />
                          <p>
                            {active.status === "settling"
                              ? "Confirming payment…"
                              : "Browser is collecting evidence…"}
                          </p>
                        </div>
                      )}
                      {active.status === "awaiting_payment" && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={retry}
                        >
                          Continue with wallet <Wallet size={16} />
                        </button>
                      )}
                      {active.error && (
                        <p className="error-text">{active.error}</p>
                      )}
                      {active.status === "failed" && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={retry}
                        >
                          Retry execution without payment
                        </button>
                      )}
                      {active.result && (
                        <>
                          <div className="report-summary">
                            <strong>
                              {checks.filter((c) => c.passed).length}
                              <span> / {checks.length}</span>
                            </strong>
                            <div>
                              checks passed
                              <span>
                                {(active.result.durationMs / 1000).toFixed(1)}s
                                execution
                              </span>
                            </div>
                          </div>
                          <div className="check-list">
                            {checks.map((c, i) => (
                              <div className="check-row" key={i}>
                                <span
                                  className={
                                    c.passed ? "check-pass" : "check-fail"
                                  }
                                >
                                  {c.passed ? (
                                    <Check size={17} />
                                  ) : (
                                    <X size={17} />
                                  )}
                                </span>
                                <div>
                                  <strong>{c.name}</strong>
                                  <p>{c.observed}</p>
                                  <small>Expected: {c.expected}</small>
                                </div>
                              </div>
                            ))}
                          </div>
                          {active.result.screenshot && (
                            <a
                              className="screenshot-link"
                              href={
                                "/api/proofrun/runs/" +
                                active.id +
                                "/screenshot"
                              }
                              target="_blank"
                              rel="noreferrer"
                            >
                              <img
                                alt="Browser screenshot captured during this run"
                                src={
                                  "/api/proofrun/runs/" +
                                  active.id +
                                  "/screenshot"
                                }
                              />
                              <span>
                                Open full screenshot <ExternalLink size={14} />
                              </span>
                            </a>
                          )}
                          <details>
                            <summary>
                              Console errors ({active.result.console.length})
                            </summary>
                            <pre>
                              {active.result.console.join("\n") ||
                                "No console errors recorded."}
                            </pre>
                          </details>
                        </>
                      )}
                      {active.transaction && (
                        <a
                          className="transaction"
                          href={"https://snowtrace.io/tx/" + active.transaction}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View mainnet payment <ExternalLink size={14} />
                        </a>
                      )}
                      <button className="secondary" onClick={download}>
                        <FileJson size={16} />
                        Download JSON report
                      </button>
                    </div>
                  )}
                </section>
              </div>
              <section className="recent">
                <div className="section-heading">
                  <h2>Recent runs</h2>
                  <button onClick={() => setView("history")}>
                    View all runs <ArrowUpRight size={15} />
                  </button>
                </div>
                <RunTable runs={runs.slice(0, 4)} select={select} />
              </section>
            </>
          )}
          {view === "history" && (
            <section className="panel">
              <RunTable runs={runs} select={select} />
            </section>
          )}
          {view === "api" && (
            <div className="docs-grid">
              <section className="panel docs">
                <h2>Let your agent close the loop.</h2>
                <p>
                  Create a run, authorize its quoted payment, then retrieve the
                  evidence. Keep the returned access token private.
                </p>
                <ol>
                  <li>
                    <strong>Create</strong>
                    <code>POST /v1/runs</code>
                    <p>Submit a URL, check type, and unique idempotency key.</p>
                  </li>
                  <li>
                    <strong>Pay & execute</strong>
                    <code>POST /v1/runs/:id/execute</code>
                    <p>
                      The x402 client handles the 402 challenge. Payments settle
                      in USDC on Avalanche mainnet.
                    </p>
                  </li>
                  <li>
                    <strong>Inspect</strong>
                    <code>GET /v1/runs/:id</code>
                    <p>
                      Poll for completion. Read the report and screenshot
                      without paying again.
                    </p>
                  </li>
                </ol>
                <div className="setup-callout">
                  <strong>Charge policy</strong>
                  <p>
                    You pay for execution, including tests that find a bug.
                    Service failures may be retried once without paying again.
                    Uncertain settlements require reconciliation.
                  </p>
                </div>
              </section>
              <section className="code-panel">
                <div>
                  <span>agent-client.ts</span>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(example);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    <Copy size={15} />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre>{example}</pre>
              </section>
            </div>
          )}
          {view === "settings" && (
            <section className="panel settings-panel">
              <h2>Service connections</h2>
              <div className="setting">
                <div>
                  <strong>Browser worker</strong>
                  <p>Isolated Chromium execution and durable reports.</p>
                </div>
                <span
                  className={"pill " + (health?.connected ? "green" : "amber")}
                >
                  {health?.connected ? "Connected" : "Not connected"}
                </span>
              </div>
              <div className="setting">
                <div>
                  <strong>Avalanche mainnet payments</strong>
                  <p>USDC settlement through an x402 facilitator.</p>
                </div>
                <span
                  className={
                    "pill " + (health?.paymentsReady ? "green" : "amber")
                  }
                >
                  {health?.paymentsReady ? "Enabled" : "Not activated"}
                </span>
              </div>
              <div className="setting">
                <div>
                  <strong>Network</strong>
                  <p>Avalanche C-Chain · Chain ID 43114</p>
                </div>
                <span className="pill">MAINNET</span>
              </div>
              <p>
                Deploy the included browser worker with a persistent volume, set
                its receiving wallet and facilitator, then connect its URL and
                service token to this workspace. The source includes Docker
                configuration and a deployment guide.
              </p>
              <p className="field-note">
                Never enter a private key in this dashboard. Wallet signatures
                stay in your wallet.
              </p>
              <button className="secondary" onClick={refresh}>
                Check connections
              </button>
            </section>
          )}
          <footer>
            <span>
              proofrun. <span>Evidence before confidence.</span>
            </span>
            <span>
              Powered by Avalanche & x402 <ArrowUpRight size={13} />
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function RunTable({ runs, select }: { runs: Run[]; select: (r: Run) => void }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Website / Run</th>
            <th>Status</th>
            <th>Created</th>
            <th>Payment</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.length ? (
            runs.map((r) => (
              <tr key={r.id}>
                <td>
                  <button className="table-run" onClick={() => select(r)}>
                    <Globe size={16} />
                    <span>
                      {r.demo ? "Built-in test fixture" : r.url}
                      <small>{r.id.slice(0, 8)}</small>
                    </span>
                  </button>
                </td>
                <td>
                  <span
                    className={
                      "pill " +
                      (r.status === "completed"
                        ? "green"
                        : r.status === "failed"
                          ? "red"
                          : "amber")
                    }
                  >
                    {r.status.replaceAll("_", " ")}
                  </span>
                </td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  {r.demo
                    ? "Free demo"
                    : r.transaction
                      ? r.price + " USDC"
                      : "Unpaid"}
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label="Open report"
                    onClick={() => select(r)}
                  >
                    <ArrowUpRight size={17} />
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="table-empty">
                No runs yet. Your first report will appear here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
