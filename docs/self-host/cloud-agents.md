# Cloud coding agents

Cloud agents delegate a repository task to a hosted coding agent and track its result in the bot's chat. They are separate from the bot computer and its in-turn subagents. Web, Electron, and mobile show the same status and pull-request link.

The default is `CLOUD_AGENT_PROVIDER=none`. Core workflows do not require Cursor or any other hosted coding provider.

## Self-hosted Codex server

Rakazo can use a Codex app-server host on the same private LAN instead of a
hosted vendor. The worker opens an SSH connection to a forced-command identity
and the Codex LXC owns each detached job under `/srv/rakazo-bridge`; bot
computers never receive this key and port `1455` remains loopback-only.

Configure the API and worker with the same non-secret connection settings, and
mount the private key and the pinned host-key file into the worker only:

```dotenv
CLOUD_AGENT_PROVIDER=codex
CLOUD_AGENT_SPACE_ID=<space-id>
CODEX_SERVER_HOST=192.168.1.236
CODEX_SERVER_USER=codex
CODEX_SERVER_PORT=22
CODEX_SSH_KEY_PATH=/run/secrets/codex_server_key
CODEX_SSH_KEY_FINGERPRINT=SHA256:<fingerprint>
CODEX_SERVER_KNOWN_HOSTS_PATH=/run/secrets/codex_server_known_hosts
CODEX_SSH_TIMEOUT_MS=30000
```

The SSH public key must be restricted on the server with `from=`,
`restrict`, `no-pty`, and the exact forced command
`/usr/local/sbin/rakazo-codex-bridge`. The bridge accepts only `launch`,
`status`, `reply`, and `cancel`; prompts and repository URLs are base64
encoded by the worker and repository URLs must be HTTPS without credentials.
Launches require an explicit repository URL. The bridge clones a known local
repository when available, otherwise it creates an isolated shallow checkout
under `/srv/rakazo-bridge/jobs/<id>` and runs `codex exec` on a per-operation
branch. When the repository is private on GitHub, the checkout uses the Codex
LXC's existing `gh` login through a one-shot Git credential helper; tokens are
never sent by the bot, placed in the clone URL, or written to job files.
No-repository launches are not supported by this provider. `openPr` is
intentionally not advertised as a server-side guarantee; push/PR credentials
must be added as a separate, approval-gated integration.

Rotate the key by stopping or finishing active Codex operations, installing the
new public key and worker secret, then restarting the worker. The connection
fingerprint is part of the persisted provider binding, so a changed key fails
closed instead of silently routing existing operations to a different server.

## Enable Cursor

Configure the API and worker with the same values:

```dotenv
CLOUD_AGENT_PROVIDER=cursor
CLOUD_AGENT_SPACE_ID=example-space-id
CURSOR_API_KEY=replace-with-your-key
```

The key and explicit Space ID are both required. Use a credential whose connected repositories may be accessed by members of that Space. Each created agent is additionally bound to its initiating user; another user cannot inspect, reply to, or cancel it by supplying an agent ID. The deployment key is never a model tool argument.

The tools are `cloud_agent_launch`, `cloud_agent_status`, `cloud_agent_reply`, and `cloud_agent_cancel`. All three mutations participate in the existing action-approval rules and auto-review policy. As with other consequential tools, an empty rule set and disabled auto-review permit execution by default.

Launch accepts a prompt, optional repository, images, and `openPr`. Raw environment variables are intentionally unsupported: passing secrets through model-generated tool arguments would persist them in ordinary history. Configure remote environment secrets directly with the provider.

## Recovery

The database stores ownership and pending operations independently of chat cards. The worker and reconciler recover queue failures and interrupted launches. Cursor creates use a stable client agent ID, so retrying an accepted create does not create another remote agent.

Each follow-up tracks its own remote run. When a follow-up response is lost, the worker observes the latest run instead of resending the prompt. Until it can distinguish the new run, status remains pending; it does not claim the older run completed the follow-up. Cancellation likewise remains pending until the remote state confirms it. If a request's outcome remains unknown indefinitely, inspect the agent on the provider's site.

Clearing a chat, deleting or archiving its bot, or removing the owner's Space membership causes pending remote work to be cancelled on the next reconciliation. Clearing a chat does not erase ownership or recreate the removed card. Terminal notifications are deduplicated in the durable record.

The stored credential binding fails closed if the key or provider changes. Cancel or finish active agents before rotating credentials, changing the authorized Space, or disabling the provider. If changed prematurely, restore the previous configuration to reconcile those agents, or stop them directly with the provider. No existing agent is silently routed through a replacement credential.

## Offline verification

`CLOUD_AGENT_PROVIDER=emulator` is an in-process provider for development and web E2E. It is not durable across separate processes.

The Cursor HTTP emulator also tests the real adapter without network calls. The same conformance suite covers both providers, and `pnpm test:integration` exercises the database lifecycle against the Cursor emulator: lost responses, stale run metadata, queue outages, ownership boundaries, cleared chats, worker restart, overlapping polls, and cancellation races.
