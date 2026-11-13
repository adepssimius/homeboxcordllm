# homeboxcordllm

Claude, in Discord, looking after your [Homebox](https://github.com/sysadminsmedia/homebox)
inventory. Self-hosted.

You mention the bot in a channel and it opens a thread. In the thread it works
the inventory through [homebox-mcp](https://github.com/dgahagan/homebox-mcp):
items, locations, tags, custom fields, warranties, maintenance, attachments,
labels. Ask *"where's the stud finder?"*, *"what's in Garage/Tote 3?"*, or
*"which warranties run out this year?"*, or post a photo and say *"add this to
the garage shelf"*.

Built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), in
the same shape as fitcordllm, disk8sllm and hasscordllm.

## Photos

Attach images (or a PDF manual or receipt) to any message, with or without
text. The bot:

1. saves each file to `WORKSPACE/inbox/<conversation>/` the moment the message
   arrives (Discord's links expire),
2. shows JPEG, PNG, WebP, GIF, AVIF and TIFF photos to Claude directly in the
   message, shrunk to 1568px and re-encoded, so *"what is this?"* costs no tool
   call. Anything else (HEIC, PDF) is listed with its path and Claude Reads it,
3. tells Claude each file's path, which it passes to `attach_document` to put
   the original on the item or location. homebox-mcp converts HEIC to JPEG on
   upload.

So *"here's the drill, add it to Garage/Shelf A"* with a photo of it and one of
its serial plate becomes one item with make, model and serial read off the
plate, and both photos attached, the first as primary. A photo of a tote can be
attached to the location, so it shows where things are kept.

Video and audio are skipped. Files over `ATTACHMENT_MAX_BYTES` (25 MB) or past
`ATTACHMENTS_PER_MESSAGE` (10) are skipped too, and Claude is told which. Inbox
files are deleted after `INBOX_RETENTION_DAYS` (30): once attached, the photo
lives in Homebox.

Labels and QR codes from `generate_label` / `qrcode` land in
`WORKSPACE/labels/`, and the bot posts any new ones to the thread after the
reply, ready to print.

## Approval

Every Homebox tool call is sorted into a tier
([`src/homebox/classify.ts`](src/homebox/classify.ts)):

| Tier | What | At the default level |
| --- | --- | --- |
| **read** | search, get, list, stats, warranties, barcode lookup, and tools that only write a local file (export, label, QR, download) | goes straight through |
| **write** | create, edit, move, tag, attach, mark sold, log maintenance | goes straight through |
| **destructive** | every `delete_*`, and `import_csv` (it can overwrite many items in one call) | **waits for Approve** |

`BOX_APPROVAL_LEVEL` moves the line (`write` / `destructive` / `none`). A tool
the classifier doesn't recognise counts as a write, or destructive if its name
says it deletes.

The card shows a one-line summary (*Delete item “Old drill”*), why it was asked,
and the exact input, with **Approve**, **Approve rest of reply** (never on a
destructive call) and **Deny**. An unanswered card is a refusal after
`APPROVAL_TIMEOUT_MS` (15 minutes). Only people on `DISCORD_APPROVER_USER_IDS`
/ `ROLE_IDS` can press the buttons; with both empty, anyone allowed to chat
can. Every decision is recorded in the `approvals` table.

Why it can't be skipped: the approval happens in the SDK's `canUseTool`, and
`allowedTools` is empty, so no Homebox tool is pre-approved. The `PreToolUse`
gate also answers `ask` for any call that needs approval.

## Scheduled briefs

Ask in a thread: *"on the 1st of every month, list warranties expiring in the
next 90 days and maintenance that's due"*. The prompt runs on schedule in a
fresh conversation, and the answer is posted to the channel. Reply to it or
start a thread from it to continue. A scheduled run only looks: every Homebox
call that isn't a read is refused.

Mention the bot with `schedules` to list them, or `threads` to list recent
conversations.

## Inventory notes

The agent's working directory is `DATA_DIR/workspace`, shared by every thread.
Its `CLAUDE.md` is the inventory notes, loaded into every conversation and kept
current by the agent: what people call places (*"the garage cabinet"* is
`Garage/Cabinet 2`), tagging and custom-field conventions, naming rules. It's
seeded on first start. Pasting in your conventions is a good first message.

## What the agent can and cannot do

- **Homebox**, through homebox-mcp, under the approval rules above.
- **Files**: Read, Write and Edit, confined to the workspace and `/tmp`.
- **homebox-mcp's own file access is confined the same way.** `attach_document`
  uploads a local path and `get_attachment`, `export_csv` and the label tools
  write one, so the policy holds those paths to the workspace too. Without that,
  `attach_document(source="/proc/self/environ")` would upload the Homebox token
  into Homebox. `attach_document` may also take an http(s) URL, which is how a
  manual found by web search gets attached. That download happens from inside
  the pod.
- **Web search.** No `WebFetch`, no subagents.
- **No shell.** The Homebox token is in the homebox-mcp subprocess's
  environment only, not the agent's ([`sanitizedEnv`](src/config.ts)).
- **Only the MCP servers the bot defines.** `strictMcpConfig` is on.

## Running it

### Discord

1. Create a **new** application and bot. Don't reuse another bot's token.
2. **Enable the Message Content privileged intent.**
3. Invite it with `View Channel`, `Send Messages`, `Create Public Threads`,
   `Send Messages in Threads`, `Add Reactions`, `Read Message History`,
   `Embed Links`, `Attach Files` (for labels), and `Create Polls`.
4. Give it a private channel: `DISCORD_CHAT_CHANNEL_IDS`.

### Homebox

Homebox 0.26 or later. Create an API token (ideally as a dedicated user in the
same group) and set `HOMEBOX_URL` and `HOMEBOX_TOKEN`.

### Configuration

Everything is environment variables; [`.env.example`](.env.example) lists them.

| Variable | |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | from `claude setup-token` |
| `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHAT_CHANNEL_IDS` | |
| `HOMEBOX_URL`, `HOMEBOX_TOKEN` | |
| `DATA_DIR`, `HOME` | both on persistent storage |

[`deploy/README.md`](deploy/README.md) describes the Kubernetes shape.

## Local development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

`pnpm chat` runs the same session manager, policy and tools from stdin, with no
Discord needed. `/attach <path>` posts a local photo with your next message.
Approval cards are printed; `CHAT_APPROVE=never` (the default) refuses
everything that needs approval, `CHAT_APPROVE=always` lets it through.

```bash
DATA_DIR="$PWD/.local" AGENT_INHERIT_ENV=true \
HOMEBOX_URL=https://homebox.example HOMEBOX_TOKEN=… \
HOMEBOX_MCP_COMMAND=uvx HOMEBOX_MCP_ARGS="--python 3.13 --from homebox-mcp==1.5.1 homebox-mcp" \
  pnpm chat
```
