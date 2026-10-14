# Blockchain Explorer web

Next.js App Router frontend for the workspace API Gateway. Copy `.env.example` to `.env.local`; only the API URL belongs in this app's environment.

From the repository root:

```powershell
pnpm install
pnpm build:packages
pnpm dev:web
```

Open http://localhost:3003. Start infrastructure and the three backend services separately. Production: `pnpm --dir apps/web build`, then `pnpm --dir apps/web start`. Frontend tests: `pnpm --dir apps/web test`. Full isolated smoke: `pnpm verify:phase9`.

Architecture, API/session behavior, security limits and verification are documented in `../../docs/phase-9-frontend.md`.
