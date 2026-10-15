# Verification — October 16, 2026 (IST)

## Current configuration: Fuji testnet

The project now targets Avalanche Fuji (`eip155:43113`) and Circle test USDC. Mainnet authorizations and historical mainnet quotes are rejected before settlement. Wallet network selection, agent client, reconciliation RPC, and explorer links use Fuji. Payments remain inactive while receiving wallet/facilitator configuration is missing. No on-chain transaction was made.

Seven core tests and TypeScript checks passed after the switch, including regression tests for mainnet rejection and one-time settlement. The local health proxy returned `network: eip155:43113` and `paymentsReady: false`. Browser service setup showed Fuji chain 43113, test USDC, and payments not activated; see `qa-fuji-setup.png`.

The final production build passed. A fresh free demo completed in the dashboard with the expected 1/3 passing checks, missing validation message, console error, and screenshot. Wallet signing and on-chain Fuji settlement await the receiving address and facilitator; they have not been verified.

The original verification below describes the earlier mainnet-configured checkout; its screenshot is historical evidence, not the current configuration.

The existing ProofRun implementation and Site identity were retained.

## Passed

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` exited 0.
- Production dashboard: `node scripts/run-framework.mjs build` completed all five build phases and exited 0.
- Five worker core tests passed: egress policy, malformed payment rejection, access/idempotency/concurrent one-time settlement, uncertain settlement handling, and dashboard authentication. Payments used a mock facilitator.
- The real browser fixture test passed with `TEST_BROWSER=1` and `BROWSER_CHANNEL=msedge`. The default attempt failed because bundled Playwright Chromium was not installed; the supported Edge fallback passed.
- Local dashboard and health proxy returned HTTP 200. Worker health reported `connected: true`, `paymentsReady: false`, and `paymentStatus: configuration_required`.
- In-app browser UI: paid-run button disabled; free demo executed and completed; report displayed 1/3 passing checks, the expected missing validation message, one console error, and a screenshot thumbnail.
- JSON report downloaded and parsed successfully; saved as `qa-demo-report.json`. History survived reload, and the same report reopened without another execution.
- Validation check selection exposed selector and expected-message fields. Service setup showed connected worker and unactivated mainnet payments; evidence saved as `qa-service-setup.png`.

## Deployment preparation

Added a Compose health check and excluded `.env` variants from the worker Docker context. See `deployment.md` for staging, activation later, persistent storage, and rollback instructions.

## Remaining limits

Docker is unavailable in this environment, so the Linux image and Chromium sandbox were not validated. No hosting deployment or mainnet settlement was performed. A selected persistent container host and HTTPS origin are needed for deployment; activation additionally requires the receiving address, compatible facilitator, and an approved real payment verification. Mobile layout and wallet signing were not tested.
