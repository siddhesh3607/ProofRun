# Deployment handoff

Continue the existing Site `appgprj_6ab16e49e23881919c29898a146c501d`; preserve `.openai/hosting.json`. Do not create a replacement Site.

## Stage with payments disabled

1. Provision a Linux container host with Chromium sandbox support, 2 GB RAM, and a persistent `/data` volume. The Sites dashboard cannot host Chromium.
2. On that host, copy `worker/.env.example` to `worker/.env`. Generate a persistent random `SERVICE_TOKEN` of at least 32 characters. Set `PUBLIC_API_URL` to the worker's final HTTPS origin. Leave `PAY_TO`, `FACILITATOR_URL`, and `FACILITATOR_TOKEN` empty. Do not copy the local SQLite database into the image.
3. Run `docker compose up -d --build` from the project root. The worker binds localhost on the host; terminate HTTPS with a reverse proxy. Preserve the named volume across updates. Do not use `docker compose down -v` when updating.
4. Check `/health`: expect `connected: true`, `paymentsReady: false`, and `paymentStatus: "configuration_required"`. Docker health checks test service availability, so disabled payments do not make the container unhealthy.
5. Set the existing dashboard's server-side `PROOFRUN_WORKER_URL` to the worker HTTPS origin and `PROOFRUN_SERVICE_TOKEN` to the same private token. Keep secrets out of the hosting manifest, client code, and archives.
6. Run the dashboard production build (`npm run build`), then package and deploy through the Sites workflow using the existing project ID. Preserve its audience. Deployment has not been performed by this handoff.
7. On the deployed dashboard, check the worker is connected and payments say **Not activated**. Execute **Try the built-in demo**. Expect a completed free report with a passing page load, failed form-validation check, one console error, and a PNG screenshot. Reload, reopen the report from history, and download its JSON. Paid execution should remain disabled.

## Verification commands

From the root: `npx tsc --noEmit` and `npm run build`.

From `worker`: `npm test`, then `TEST_BROWSER=1 npm test` on Linux. On Windows, use `$env:TEST_BROWSER='1'; $env:BROWSER_CHANNEL='msedge'; npm test` if the bundled Chromium is absent. Production uses Playwright Chromium from the Docker image; Edge verification does not validate the Linux container sandbox.

## Activate later

Wait for the receiving wallet address. Then set `PAY_TO` and a HTTPS `FACILITATOR_URL` that supports exact payments on `eip155:43113` (plus its bearer token if required), restart the worker, and verify `paymentsReady: true` and `network: "eip155:43113"`. Keep the service token stable. Verify a test-USDC payment and its Fuji explorer receipt before claiming testnet settlement. Test tokens have no financial value. No on-chain payment has been made during preparation. Mainnet is not enabled by this configuration.

## Release checks and recovery

- Validate the Linux image and sandbox on the selected host before release; do not disable the sandbox to make the container work.
- Apply host-level egress restrictions, retention limits, monitoring, and database backups before unrestricted public execution.
- Back up `/data` consistently, including SQLite WAL state; stop the worker for a simple filesystem backup. Retain the previous image to roll back without deleting the volume.
- If a settlement becomes uncertain later, hold the run and use the README reconciliation procedure; do not request another payment.
