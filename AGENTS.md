# ProofRun project instructions

Continue the existing project; do not recreate it. Read README.md for architecture and setup. The current payment network is Avalanche Fuji testnet. Keep mainnet disabled unless the user explicitly changes that requirement.

## GitHub synchronization

The user requests that every future project change be synced to https://github.com/siddhesh3607/ProofRun after the relevant checks pass. Commit and push completed changes automatically within the authorized task; no additional conversational confirmation is needed. Preserve remote history, do not force-push, and report the pushed commit or any blocker. If checks fail, fix them before syncing or explain the unresolved failure.

The working project root currently has no Git metadata. Its publishing clone is `.sites-runtime/github-publish`, on `main`, with `origin` pointing to the repository above. Reuse it while present. Copy only intended project source changes into that clone, inspect the staged diff, commit, push, and verify the remote head. If source files are intentionally deleted, apply those specific deletions to the publishing clone too. Do not overwrite unrelated remote work.

Never sync `.env`, `.dev.vars`, credentials, private keys, dependencies, build outputs, local databases, or checkout-local runtime state. Empty `.env.example` templates may be committed. Keep existing Site identity and do not publish the hosted application merely because source is synced to GitHub.
