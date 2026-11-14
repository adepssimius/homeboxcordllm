import { join } from "node:path";
import {
  ALLOW,
  confinePathArgs,
  defineBot,
  INBOX_DIR,
  NOTES_FILE,
  optionalString,
  sharedWorkspace,
  z,
  type McpServerConfig,
} from "discordllm";
import { summarizeCall } from "./card.js";
import { BOX_SERVER, classify, PATH_ARGS, TIERS, URL_ARGS } from "./classify.js";
import { phrasebook } from "./phrases.js";
import { systemAppend } from "./prompts.js";

/**
 * homeboxcordllm: Claude, in Discord, looking after a Homebox inventory.
 *
 * Everything that is the same for any bot of this shape — threads, the ledger,
 * approval cards, schedules, polls, the options that keep the agent contained
 * — is discordllm's. What is here is what is Homebox's: the server and its
 * token, which tools are dangerous, where posted photos and generated labels
 * go, and what the agent is told.
 */

/** Workspace-relative: labels and QR codes homebox-mcp generates, posted back to the thread. */
export const LABEL_DIR = "labels";

export const NOTES_SEED = `# Inventory notes

Kept by homeboxcordllm. Loaded into every conversation. Short, current, no secrets.

## Locations and what people call them

## Tagging and custom-field conventions

## Item naming conventions

## Recurring tasks and decisions
`;

export default defineBot({
  name: "homeboxcordllm",
  tiers: TIERS,
  tierLabels: { write: "Change" },
  // Photos of an item, a serial plate, a receipt: saved to the inbox, shown to
  // the model, and handed to `attach_document` by path.
  attachments: true,
  secrets: ["HOMEBOX_TOKEN"],
  envAliases: { BOX_APPROVAL_LEVEL: "APPROVAL_LEVEL" },

  env: {
    /**
     * The URL is not a secret; the token is. Held by the bot process and
     * handed only to the homebox-mcp subprocess, never to the agent's own
     * environment — and the agent has no shell to go looking for it.
     */
    HOMEBOX_URL: optionalString,
    HOMEBOX_TOKEN: optionalString,
    /** Optional custom field homebox-mcp also matches identifiers against. */
    HOMEBOX_ALIAS_FIELD: optionalString,
    /** The homebox-mcp server. The image installs a pinned version on PATH. */
    HOMEBOX_MCP_COMMAND: z.string().default("homebox-mcp"),
    HOMEBOX_MCP_ARGS: z.string().default(""),
  },

  setup({ cfg, env, log }) {
    const labelDir = join(cfg.workDir, LABEL_DIR);

    // Without Homebox the bot still starts and says so in every answer that
    // needs it — a missing token is a configuration problem to report, not a
    // reason to crash-loop.
    const servers: Record<string, McpServerConfig> = {};
    if (env.HOMEBOX_URL && env.HOMEBOX_TOKEN) {
      servers[BOX_SERVER] = {
        type: "stdio",
        command: env.HOMEBOX_MCP_COMMAND,
        args: env.HOMEBOX_MCP_ARGS.split(/\s+/).filter((a) => a.length > 0),
        // homebox-mcp also reads a `.env` next to its own module file. In the
        // image that is inside the read-only venv, where none exists.
        env: {
          HOMEBOX_URL: env.HOMEBOX_URL,
          HOMEBOX_TOKEN: env.HOMEBOX_TOKEN,
          ...(env.HOMEBOX_ALIAS_FIELD ? { HOMEBOX_ALIAS_FIELD: env.HOMEBOX_ALIAS_FIELD } : {}),
          // Labels and QR codes land in the workspace, where the agent can see
          // them and the bot can post them to Discord.
          HOMEBOX_LABEL_DIR: labelDir,
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: process.env.HOME ?? "/tmp",
        },
      };
    } else {
      log.error("HOMEBOX_URL or HOMEBOX_TOKEN is unset — Homebox tools disabled");
    }

    const workspace = sharedWorkspace({
      dir: cfg.workDir,
      notesSeed: NOTES_SEED,
      dirs: [INBOX_DIR, LABEL_DIR],
      // Once a photo is attached it lives in Homebox; a label is printed once.
      prune: [LABEL_DIR],
      retentionDays: cfg.INBOX_RETENTION_DAYS,
      onPruned: (removed) => log.info({ removed, days: cfg.INBOX_RETENTION_DAYS }, "pruned old label files"),
    });

    return {
      servers,
      workspace,
      classify,
      /**
       * homebox-mcp reads and writes local files on the agent's behalf:
       * `attach_document` uploads a path, `get_attachment` and the label tools
       * write one. Those paths are held to the workspace like the agent's own
       * file tools. Without that, `attach_document(source="/proc/self/environ")`
       * would upload the Homebox token into Homebox.
       */
      policy: (call) =>
        call.server === BOX_SERVER
          ? confinePathArgs(call, { known: PATH_ARGS[call.tool] ?? [], allowUrlIn: URL_ARGS })
          : ALLOW,
      describe: summarizeCall,
      phrasebook,
      postFilesFrom: cfg.POST_GENERATED_FILES ? [labelDir] : [],
      startup: {
        homebox: env.HOMEBOX_URL ?? "disabled",
        homeboxMcp: env.HOMEBOX_MCP_COMMAND,
        workspace: cfg.workDir,
      },
      briefNote:
        "This run only looks. Every change to Homebox is refused during it, so do not try; if\n" +
        "something should be changed, say what and why, and the person can ask for it from the thread.",

      async turn(info) {
        await workspace.init();
        return {
          systemPrompt: systemAppend({
            timeZone: info.timeZone,
            hasHomebox: BOX_SERVER in servers,
            approvalLevel: info.approvalLevel,
            botTool: info.botTool,
            notesFile: NOTES_FILE,
            inboxDir: INBOX_DIR,
            labelDir: LABEL_DIR,
          }),
        };
      },
    };
  },
});
