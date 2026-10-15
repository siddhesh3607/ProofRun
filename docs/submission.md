# ProofRun — Speedrun submission draft

## One-line description
AI coding agents purchase browser verification through x402 on Avalanche, then use the resulting screenshots and structured failures to fix their work.

## Problem
A coding agent can produce plausible code while missing a broken browser interaction. Developers need observable execution evidence, and agents need a way to purchase that capability per task.

## What the prototype does
A client creates a test request, authorizes a quoted USDC payment, and receives a browser report. The report includes expected versus observed behavior, a screenshot, console errors, and the settlement transaction when payment is enabled.

## Avalanche fit
x402 exact payments settle in test USDC on Avalanche C-Chain Fuji testnet. The browser work happens off-chain. A payer can purchase a single run without a subscription. Repeated requests retrieve the same job without a second settlement.

## What is original here
The product workflow couples a paid browser job with structured evidence for the coding agent. The reusable parts are the bounded agent client and durable payment-to-job state handling. Browser automation and x402 are existing technologies; do not claim to have invented them.

## Three-minute demo
- 0:00–0:20: Show a test app with a broken validation message.
- 0:20–0:45: The agent creates a test and receives the x402 quote.
- 0:45–1:10: Authorize a small Fuji testnet payment; show the actual explorer transaction.
- 1:10–1:40: Show the browser report, failed assertion, console error, and screenshot.
- 1:40–2:10: Fix the test app's handler and start a second check.
- 2:10–2:35: Show the successful report. Reopen it without another charge.
- 2:35–3:00: Explain Avalanche settlement, retry handling, and the reusable client.

The built-in free fixture is useful for previewing the product, but it is not a substitute for the paid Fuji testnet demo.

## Pitch-slide outline
1. Problem: generated code needs real browser evidence.
2. Product: request → x402 payment → browser run → evidence → fix.
3. Technical depth: isolation, durable jobs, one-time settlement, recovery.
4. Avalanche: actual Fuji testnet USDC payment and explorer receipt.
5. Validation and next steps: verified runs, early user feedback, deployment limitations.

## AI-tool disclosure
Built with Codex for implementation, debugging, and documentation. Review the architecture and payment-state logic before presenting; explain the code in your own words.

## Items still required before submission
- Fuji-compatible facilitator and persistent browser-worker hosting. Receiving wallet is configured in `worker/.env.example`.
- An actual verified Fuji testnet payment.
- A public source repository (the Sites source repository is not a substitute for a public GitHub link).
- Live demonstration on the final deployment.
- Pitch slides and a recorded video under three minutes.
- Real user feedback; do not invent usage metrics or customer adoption.

The event page says October 21 in its narrative and October 22 at 03:29 AM IST in the submission widget. Target October 21.

