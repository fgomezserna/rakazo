# Rakazo project context

> Durable orientation for contributors and future Codex tasks. This document is
> public-safe: it contains no credentials, private endpoints, customer data or
> machine identifiers. Re-check the repository, CI and the served deployment
> before treating a time-sensitive statement as current.

## Scope and repository state

Rakazo is the open-source fork being evolved for a self-hosted team deployment.
The checkout is a pnpm 9/Turbo monorepo with TypeScript, React/Vite, Hono/oRPC,
Prisma/PostgreSQL, Better Auth, Graphile Worker, Pi and optional computer/model
providers.

At the snapshot recorded on 2026-09-12:

- The active branch is `feat/move-bots-between-workspaces` and tracks the fork
  remote. `origin` is the upstream repository; `fork` is the integration remote.
- The head is `5c2ff955` (`fix: recover stale docker computer screens`). The
  preceding noVNC fixes are `9c22abf5` and `645f1a41`.
- The working tree was clean before these documentation files were added. Always run
  `git status --short --branch` before editing or preparing a commit.

The Codex project points at this checkout. The repository is the source of
truth; Codex project metadata is only a convenient way to open it with the
right instructions.

## Architecture map

```text
web / Electron / Expo
          |
       apps/api  <->  apps/worker (Pi runs and Graphile jobs)
          |
 packages/contracts + core + db + adapters + chat-ui
          |
 Postgres + DATA_DIR + SandboxProvider
          |
 Docker supervisor/computer | E2B | Daytona | Box | desktop | fake
```

- `apps/web` is the browser UI and Vite preview; Electron hosts the same web
  experience and Expo mobile calls the same API.
- `apps/api` owns authorization, orchestration, RPC and screen/credential
  boundaries. `apps/worker` executes durable background work.
- `packages/contracts`, `packages/core`, `packages/db` and `packages/adapters`
  hold shared domain contracts, policies, persistence and provider translation.
- `infra/compose` contains the source and published-image Compose paths.
  `infra/sandboxes/computer` builds the Linux desktop/noVNC image and
  `infra/sandboxes/supervisor` owns Docker lifecycle and screen capabilities.
- A Team Computer shares files and installed tools among bots in one workspace;
  each bot still has its own display and Chrome profile. Private Computers are
  the isolation option. Durable workspace files and browser profiles are
  checkpointed through `DATA_DIR`; the disposable OS image is not a backup.

## Local development and validation

Prerequisites and environment names are maintained in `README.md`,
`.env.example` and `docs/self-host.md`. The normal source checkout path is:

```bash
cp .env.example .env
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm sandbox:build
pnpm dev
```

Useful checks, from the repository root:

```bash
pnpm lint
pnpm check
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:computer-replay
```

The first three are the default PR signal. Integration and E2E use local test
services. Computer replay uses real Docker Chromium with an emulated model and
needs the local image; it does not prove real-model quality. `pnpm test:computer`
and `pnpm test:canary` are explicit live-provider checks that require keys and
may incur usage. Never put those keys on a command line or in this file.

For database work, `pnpm db:generate` is code generation and `pnpm db:migrate`
changes the local database. The Compose command `pnpm compose:down` includes
`-v` and therefore deletes local Postgres volumes; use it only for disposable
test data or after a backup.

## Current product line in this fork

The branch contains the following user-facing work, in chronological order:

- `2a5a8d56`: exposes `task_catalog` and hardens schedule input so a model must
  choose one repeat/one-shot mode and verify persisted routines.
- `0b73b511`, `82a27a39`, `445f00e8`, and `18c5f5d2`: move bots between
  workspaces, handle colliding creation keys, stop/restart active computers
  transparently, and update navigation without a full page reload.
- `2de29e22`: makes bot credential requests actionable while keeping values out
  of model-visible data; the encrypted secret flow is documented in
  `docs/bot-secrets.md`.
- `cd6d7d29`: adds explicit guest bots for cross-workspace groups, including
  mention-only invocation and permission checks. Keep guest memory,
  credentials and execution scoped to the owning workspace.
- The bot-sharing flow extends this boundary with persistent bot-to-workspace
  shares. A share is granted by the bot owner to another workspace in the same
  account/organization; bots in that workspace can address it through the
  teammate directory and the web composer mention picker, while the target run,
  memory, credentials and computer remain in the owner's workspace. This is not
  a cross-user invitation or a direct proxy chat.
- `e6d563f6`: adds workspace profile configuration (name and avatar) with owner
  checks and web/mobile surfaces.
- `65745ab2` through `5c2ff955`: harden the noVNC screen path: retry transient
  proxy failures, preserve opaque capabilities, bundle the ESM assets, align
  the bootstrap token directory, and recover stale Docker screen records.

These commit summaries describe what is in the branch, not a claim that every
flow is currently deployed. For release work, compare the deployed image/tag
and run the real served-domain checks.

## noVNC and computer operations

The web screen uses a signed, revocable view/control capability through the API
proxy. The computer image serves the bundled noVNC module and clipboard/mobile
bridges; Docker screen state is recovered when a stale computer record points at
an unavailable runtime. A viewer may close without stopping the desktop; a bot
run releases its display lease, and whole-computer idle shutdown preserves the
checkpointed workspace.

When diagnosing a black or unavailable screen, inspect the current API/worker,
supervisor and computer logs, then request a fresh screen URL and test the
served UI. Do not infer success from a single HTTP 200 or from an old browser
tab. A successful check should show the embedded canvas, a usable websocket
capability and no new proxy/supervisor errors across at least one reconnect.

The recorded 2026-09-12 verification for this branch exercised the embedded
panel and a hidden browser tab, repeated panel reopen/reload cycles, and the
adapter/API regression suite (42 tests in the focused run). Re-run the same
checks after any image, proxy, supervisor or deployment change; this snapshot is
not a permanent health guarantee.

## Deployment boundaries and rollback

The supported self-host path is `infra/compose/docker-compose.images.yml` (or
the production Compose variant described in `docs/self-host.md`). The web
container is the public-facing origin behind TLS; API, worker, Postgres and the
Docker supervisor stay on private networks. `DATA_DIR` and Postgres volumes
are durable state and must be backed up off-host for production.

The live team instance is operated outside this public repository on an LXC.
Exact host details, container IDs, image tags, environment files, secret
backups and private URLs intentionally stay out of Git. Before a live update:

1. Record the current app/computer image tags and health of every Compose
   service; take the operator backup of the environment and durable data.
2. Confirm the target image exists and contains the intended commit. Keep the
   previous exact cached image/tag as the rollback target.
3. Recreate only the application path required by the update. Do not expose the
   supervisor or Postgres, and do not remove volumes.
4. Verify health, sign-in, bot navigation, task/routine behavior and the
   embedded noVNC canvas through the real public origin, not localhost.
5. If the served checks fail, restore the recorded image tags and verify the
   rollback through the same public-origin checks.

CI green, a pushed commit, or a successful image build does not by itself prove
that the public instance is serving that revision.

## Security and collaboration rules

- Never commit `.env`, tokens, API keys, passwords, private deployment data or
  real customer records. Use placeholders in examples and redact logs before
  sharing them.
- Treat workspace membership, guest-bot permissions, computer leases,
  credential references and screen capabilities as authorization boundaries.
  A cross-workspace bot is an explicit guest, not a global shared workspace.
- Keep PRs small, target `main`, describe why/what/how tested, and review the
  complete diff before pushing. Follow `.agents/skills/pr-watch/SKILL.md` for
  any PR that is actually opened.
- If a task changes UI, test the affected web/mobile state and include the
  relevant CI evidence in the PR. If it changes a provider or image, add the
  deterministic conformance/replay check before relying on a live smoke test.
