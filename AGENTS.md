# ProductAgent development instructions

- This repository is the canonical Next.js application imported from the 2026-10-17 Wukaifeng delivery. Read README.md, IMPLEMENTATION_STATUS.md, REVIEW_HANDOFF.md and docs/README.md.
- Product specifications and old task prompts contain future goals. Confirm current behavior in code; the user's current task and authorization take precedence.
- Do not replace this app with older LocalFlow/Python/Windows distributions or merge their databases.
- Use Node.js 24 and package-lock.json. Prefer feature branches and PRs to main. Never rewrite shared history without explicit authorization.
- Keep credentials, .env.local, api.txt, private material, databases, models, dependencies and build caches out of Git.
- Do not read or print the user's api.txt or secret copies. Applications may use local secrets for authentication, never as prompt/report content.
- Paid model calls require authorization for the current task. AI_ALLOW_PAID_CALLS defaults false; CI stays offline.
- Integration/migration tests use a separate PRODUCT_AGENT_DATA_DIR and preserve migration backups.
- Relevant checks: npm test, npm run typecheck, npm run test:benchmark, npm run build. Report unavailable checks honestly.
- Keep model writes behind domain authorization and transactions. Demo actors are not real authentication.
- Distinguish mocks, deterministic rules, provider output, user reports and real-world verification. Valid citation IDs are not semantic proof.
- Update DEVELOPMENT_REPORT.md, REVIEW_HANDOFF.md, IMPLEMENTATION_STATUS.md and CHANGELOG.md for substantive changes. Preserve imported reports as dated historical evidence.
