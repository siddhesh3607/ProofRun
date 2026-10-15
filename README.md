# ProofRun

Browser verification that AI agents purchase through x402 on Avalanche C-Chain.

## Current implementation

- Dashboard: test configuration, saved run history, screenshot/report viewer, JSON export, wallet payment client, API instructions.
- Worker: real isolated Chromium jobs, SQLite history and payment state, screenshot artifacts, three check types.
- Payment network: Avalanche C-Chain mainnet (eip155:43114), native USDC.
- x402 v2 exact-payment integration through the official @x402 SDK.
- A no-charge built-in fixture deliberately exposes a broken form validation handler.
- Mainnet activation requires PAY_TO and a working Avalanche-compatible facilitator.
- Browser hosting requires a long-running Node service with a persistent data volume. Sites hosts the dashboard and HTTP proxy; it does not run Chromium.

No blockchain contract deployment is required for standard x402 USDC settlement. No private key is stored by the resource server; the facilitator is responsible for submission and gas. The agent client signs with its own wallet. The browser dashboard uses a wallet extension.

## Local setup

Requires Node 22.14+ (Node 24 recommended). Run commands from this directory:

```sh
npm ci
cd worker
npm ci
npx playwright install chromium
cp .env.example .env
```

Generate SERVICE_TOKEN with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and save it privately in worker/.env. Keep this value stable: it also derives agent run access tokens.

Start the worker from its directory:

```sh
node --env-file=.env server.mjs
```

Create root .dev.vars with:

```dotenv
PROOFRUN_WORKER_URL=http://127.0.0.1:4021
PROOFRUN_SERVICE_TOKEN=<same private service token>
```

Start the dashboard from the root:

```sh
npm run dev
```

Open the printed local URL and select **Try the built-in demo**. This executes a real browser against a local HTML fixture; it does not charge tokens. For Windows environments with an installed browser, worker/.env can set BROWSER_CHANNEL=msedge or chrome. Standard production uses the installed Playwright Chromium.

The dashboard identifies local sessions using an HttpOnly cookie. Reports are durable on the worker volume, but clearing that cookie loses dashboard access to that session's reports. Agent reports use an independent bearer access token. Never share that token in public links.

## Mainnet activation

For staging with payments disabled and the existing Site identity preserved, see [deployment handoff](docs/deployment.md).

1. Deploy worker/Dockerfile on a container host that supports persistent disks, Chromium, and its sandbox. Mount /data and reserve 2 GB memory. Keep the container non-root.
2. Put the worker behind HTTPS. Set PUBLIC_API_URL to its actual HTTPS origin.
3. Set SERVICE_TOKEN, PAY_TO (your public receiving address), FACILITATOR_URL, and optionally FACILITATOR_TOKEN. PRICE_ATOMIC defaults to 100000 (0.10 USDC; USDC uses 6 decimals).
4. Confirm GET /health reports paymentsReady=true. Initialization checks facilitator support for the exact scheme on Avalanche mainnet. A facilitator outage or missing configuration disables charging.
5. Set the hosted dashboard's PROOFRUN_WORKER_URL and PROOFRUN_SERVICE_TOKEN in server-side environment variables.
6. Fund a payer wallet with a small amount of Avalanche native USDC and perform one explicitly approved payment. Check the explorer receipt, report, retry behavior, and recipient balance.
7. Record the actual mainnet demo before submitting.

Native USDC: 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E.
Chain ID: 43114. RPC: https://api.avax.network/ext/bc/C/rpc.
Do not substitute bridged USDC.e.

Use the same service-token value for the dashboard and worker, but never expose it in NEXT_PUBLIC variables, browser code, URLs, or Git. Facilitator authentication currently supports a static Bearer token; facilitators requiring per-request JWT signing need an auth adapter.

The included docker-compose.yml binds only localhost; put a TLS reverse proxy in front of it for production. Sandbox requirements differ by container host. Do not disable Chromium's sandbox to work around an incompatible public host. Use a host that supports it and apply OS-level egress restrictions as an additional boundary before a public launch.

## Checks

- load: navigate to URL; check HTTP status and capture console errors.
- navigate: click a CSS selector and check the full expected destination URL.
- validation: click a submit-button CSS selector and wait for expected visible text.

Tests do not enter credentials, upload files, run arbitrary supplied JavaScript, or perform financial actions. Only test sites you own or are authorized to test. The current runner performs empty-form submission for validation; use a designated test form.

The screenshot captures a 1280×800 viewport. It is evidence from a point-in-time run, not a cryptographic correctness proof.

## API

Create: POST /v1/runs with JSON:

```json
{
  "url": "https://your-app.example",
  "check": "load",
  "idempotencyKey": "a-new-UUID-for-this-test"
}
```

Keep id and accessToken from the response. Reuse the exact idempotency key and input to recover the same request.

- POST /v1/runs/:id/execute — bearer token required; returns 402 PAYMENT-REQUIRED before payment.
- GET /v1/runs/:id — retrieve status/report with bearer token; no second payment.
- GET /v1/runs/:id/screenshot — retrieve the PNG with bearer token.
- POST /v1/runs/:id/retry — one free execution retry for worker failures.
- GET /health — network and connection status.

The dashboard proxy uses private service credentials rather than exposing agent report tokens.

Run worker/client.mjs with PROOFRUN_API_URL and AGENT_KEY in a private local environment file. MAX_PRICE_ATOMIC limits each payment. The client persists the run token in .agent-run.json to recover across restarts; choose another RUN_STATE_FILE for a different request. Do not commit these files.

## Payment and failure semantics

An HTTP 402 quote is stored against an immutable run input. The server verifies the signature and expected terms before reserving the authorization nonce. A conditional SQLite update lets only one concurrent caller begin settlement. The nonce is globally unique across runs.

Successful settlement is saved before the browser is queued. A retry of execute returns the existing status; it does not settle a second authorization.

A failed website assertion is a completed paid test. A worker failure permits one execution retry without paying again. Repeated worker failures require operator support; automatic refunds are not implemented.

Settlement timeouts or unconfirmed responses enter settlement_unknown, including after a process restart. Do not ask the payer to pay again. Stop the worker and run:

```sh
node --env-file=.env reconcile.mjs RUN_ID TRANSACTION_HASH
```

The command verifies a successful Avalanche USDC receipt, the transfer amount and parties, and the exact AuthorizationUsed nonce. It enables a free execution retry only after matching the receipt. If no payment occurred, keep the run on hold until that fact is established; do not blindly reset it.

## Isolation and operational limits

Browser traffic uses an egress proxy that resolves and pins public destination IPs for every connection. Private, link-local, mapped loopback, and nonstandard-port requests are blocked, including redirects and subresources. Service workers are disabled. There is one active browser job, a bounded queue, request limits, and browser timeouts.

This is a sprint prototype, not a hardened multi-tenant browser cloud. Add host-level network isolation, disk retention/quotas, monitoring, abuse controls, backups, and a refund policy before opening public unrestricted execution. Browser service token holders can act as the dashboard; keep the worker's internal interfaces private where possible.

## Verification

```sh
npx tsc --noEmit
cd worker
npm test
TEST_BROWSER=1 npm test
```

PowerShell: set `$env:TEST_BROWSER='1'` before running the test command.

Core tests use a mock facilitator to exercise authorization rejection, one-time settlement, concurrent retries, bearer access, nonce replay rejection, and uncertain settlement recovery. They do not claim real mainnet settlement. Browser tests execute Chromium and verify a screenshot plus the expected failed validation check.

## Submission

See docs/submission.md for the demo script and pitch outline. Include the deployed app, public worker endpoint, source repository, pitch slides, and a video under three minutes. Only claim mainnet operation after an actual payment has been verified.

Sources:
- https://build.avax.network/events/3f8d455d-1eb5-425b-b859-4261a0ff8ad6
- https://github.com/coinbase/x402
- https://build.avax.network/academy/blockchain/x402-payment-infrastructure/04-x402-on-avalanche/02-network-setup

