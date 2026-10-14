# Isolated system verification

This ESM workspace runs Vitest against disposable Testcontainers. Docker must be running. Build the shared packages and the three Nest applications before the public E2E suite; tests execute their real `dist` entrypoints.

```sh
pnpm --dir tests build
pnpm --dir tests typecheck
pnpm --dir tests test
pnpm --dir tests test:contracts
pnpm --dir packages/contracts test
```

`test` runs integration and E2E files once. `test:integration` and `test:e2e` are subsets of that command, so their totals must not be added a second time. `test:contracts` runs decoder compatibility without Docker. Shared package guards and configuration tests run in `packages/contracts`.

Each Docker suite starts PostgreSQL `17.11-alpine`, Redis `7.4.11-alpine`, and RabbitMQ `4.3.6-management-alpine` on dynamically assigned ports. Three service-owned databases get the checked-in Drizzle migration sequence. Credentials are generated for each run. No development Compose container, volume, database, `.env`, or external provider is used as the test data store. Testcontainers removes only its own containers.

Integration checks cover fresh and upgrade migrations, database ownership, real backup/guarded restore to empty databases, Redis cache/TTL/atomic distributed limits, BullMQ deduplication/retries/final failure, RabbitMQ confirms/routing/ACK/NACK/DLQ/idempotency, and actual HTTP provider cancellation/backoff boundaries.

E2E checks use Gateway public HTTP routes, actual auth tables/JWT guards and Portfolio internal ownership enforcement. A test-only Indexer IPC launcher calls the real `BlockProcessorService`; it also measures its provider waits and PostgreSQL transaction duration for the deterministic performance script. The suite proves entity/outbox rollback, confirmed publication, broker outage recovery, source/ABI and callTracer workers, multiple native WebSocket clients, Origin filtering/deduplication, Redis failure policy, rate limiting and SDK failure isolation.

On Windows, an IPC bridge calls the actual Nest `close('SIGTERM')` lifecycle because `child.kill('SIGTERM')` forcibly terminates Windows processes. Linux production Docker verification separately sends the OS signal to PID 1. Tests require shutdown completion and zero exit status and fail on timeout; forced cleanup never counts as a passing shutdown.

Reusable compiled helpers are exported from `dist/helpers/test-environment.js`, `application-stack.js`, and `provider-fixtures.js`. `startTestEnvironment()` returns connection data plus `stop()`. `startApplicationStack(environment)` returns isolated URLs, child handles, local provider fixtures and `stop()`. Always call both cleanup functions in `finally` and never print the environment object, which contains generated credentials.

Contract tests validate the producer's shared DTO shapes through the actual Gateway allowlist and browser decoders. Native WebSocket tests verify the protocol, not browser rendering. Production frontend route/HTML smoke belongs to the production verification script; browser hydration and click behavior remain outside this suite.
