# Deploying

homeboxcordllm is one container, one replica, one persistent volume. There is no
ingress. Its only way in is the Discord gateway, which it dials out to.

## What it needs

| | |
| --- | --- |
| **Image** | `ghcr.io/<owner>/homeboxcordllm:main-<run>-<sha>`, published by CI on every push to `main`. homebox-mcp is baked in, pinned in the `discordllm.uvTools` list in `package.json`. |
| **Volume** | Mounted at `/data`, ReadWriteOnce. Holds the database (unless `DATABASE_URL` points at Postgres), the workspace (notes, posted photos, labels) and the SDK transcripts. 2–5Gi: photos are pruned after `INBOX_RETENTION_DAYS`. |
| **`HOME`** | Must be on the volume (the image sets `/data/home`). Without it, threads forget everything on restart. |
| **`/tmp`** | Writable (an `emptyDir` if the root filesystem is read-only). |
| **Strategy** | `Recreate`. Two replicas would both answer every message. |
| **Egress** | Discord (including its CDN, for posted files), `api.anthropic.com`, and Homebox. Plus wherever `attach_document` is given a URL. |
| **Probes** | `GET /healthz` (liveness), `GET /readyz` (ready once Discord is connected), `GET /metrics`. Port 8080. |
| **Kubernetes API** | None. Set `automountServiceAccountToken: false`. |

## Secrets

| Variable | |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token` |
| `DISCORD_BOT_TOKEN` | this bot's own application |
| `HOMEBOX_TOKEN` | Homebox API token, ideally for a dedicated user |
| `DATABASE_URL` | only if using Postgres instead of the SQLite file |

Everything else in [`.env.example`](../.env.example) is plain configuration.

## The reference deployment

The manifests for the author's cluster live in the GitOps repository
(`apps/homeboxcordllm/prod/`), not here. Flux's `ImageUpdateAutomation` rewrites
the image tag in place, so a copy here would drift. A merge to `main` here is
the deploy there.

## First start

1. The workspace is created (`CLAUDE.md`, `inbox/`, `labels/`) and the notes
   are seeded if missing. Inbox and label files past retention are pruned, then
   daily.
2. If `HOMEBOX_URL` or `HOMEBOX_TOKEN` is unset, the bot logs an error and runs
   without Homebox tools, saying so when asked.
3. It connects to Discord, then starts the scheduler.

The startup log line `homeboxcordllm starting` states what it ended up with:
the Homebox URL, the approval level, and who approves.

## Upgrading homebox-mcp

Bump the `homebox-mcp==…` pin under `discordllm.uvTools` in `package.json` and merge. Then check the new
version's tool list against [`src/classify.ts`](../src/classify.ts):
a tool it doesn't know counts as a write (or destructive, if named `delete_*`),
so a new read-only tool will ask at `APPROVAL_LEVEL=write` until it's added
to `READ_TOOLS`. A new tool that takes a local path belongs in `PATH_ARGS`; until then the
policy only catches it if the argument is named like a path (`*_path`,
`source`, `*_dir`, `save_to`…).
