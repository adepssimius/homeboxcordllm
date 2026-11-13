import { join } from "node:path";
import { z } from "zod";
import { INBOX_DIR, LABEL_DIR } from "./workspace.js";

/**
 * Config is split so the headless dev REPL can run with only Anthropic and
 * Homebox credentials. Discord settings are validated lazily via
 * requireDiscord() rather than at import time.
 *
 * Nothing personal has a default here. This repository is public; guild ids,
 * the Homebox address and who may approve changes all come from the
 * environment.
 */

const csv = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
  );

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

/** Treats an empty string as unset, which is how an unfilled ConfigMap key arrives. */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

/**
 * How much of what the agent does to the inventory waits for a person to press
 * Approve in Discord. Each level includes the ones after it:
 *
 *   write        every change: creating, editing, moving, tagging, attaching
 *   destructive  only deletions and bulk CSV import (the default)
 *   none         nothing — every write goes straight through
 *
 * See homebox/classify.ts for which tool lands in which tier.
 */
export const APPROVAL_LEVELS = ["write", "destructive", "none"] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];

const Schema = z.object({
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  LOG_PRETTY: bool,

  /**
   * Credentials. Exactly one is needed; the SDK resolves in this order.
   *
   * CLAUDE_CODE_OAUTH_TOKEN is the subscription path: generate it once with
   * `claude setup-token`, then store it as a Secret. It draws on subscription
   * rate limits, which is why the quota settings below exist.
   */
  CLAUDE_CODE_OAUTH_TOKEN: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_AUTH_TOKEN: optionalString,
  /**
   * DEV ONLY. Forwards the whole parent environment to the agent subprocess.
   * Needed when iterating inside an environment that brokers credentials
   * through env vars (a nested Claude Code session). Never set it in the
   * cluster: it would hand the agent the Discord and Homebox tokens.
   */
  AGENT_INHERIT_ENV: bool,
  /** Unset means the Claude Code default for the account. */
  AGENT_MODEL: optionalString,
  /** SDK turns one Discord message may spend. */
  AGENT_MAX_TURNS: z.coerce.number().int().positive().default(60),
  /**
   * Built-in tools the agent may use, beyond the MCP servers. No Bash: the
   * inventory is reached through homebox-mcp's tools, and a shell could read
   * the Homebox token out of the MCP server's environment.
   *
   * ToolSearch stays in: Claude Code may defer MCP tool schemas behind it,
   * and without it the agent would see no Homebox tools at all.
   */
  AGENT_BUILTIN_TOOLS: z
    .string()
    .default("Read,Write,Edit,Glob,Grep,WebSearch,TodoWrite,ToolSearch,ListMcpResourcesTool,ReadMcpResourceTool")
    .transform((s) =>
      s
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0),
    ),

  /** Everything that must survive a restart lives under here. */
  DATA_DIR: z.string().default("/data"),
  SQLITE_PATH: optionalString,
  /**
   * The agent's working directory, shared by every thread. Its CLAUDE.md is
   * the inventory notes; inbox/ holds photos posted in Discord. See workspace.ts.
   */
  WORK_DIR: optionalString,

  /**
   * Quota. On subscription auth these are availability controls, not cost
   * controls: exhausting the limit locks the operator out of their own editor.
   */
  AGENT_MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().default(2),
  /** Budget denominated in SDK turns, the same unit the ledger records. */
  AGENT_TURNS_PER_HOUR: z.coerce.number().int().positive().default(300),
  /** Assumed cost of a run already in flight, so simultaneous starts can't all see zero. */
  AGENT_INFLIGHT_TURN_ESTIMATE: z.coerce.number().int().positive().default(10),
  /** Utilization (0–1) at which concurrency drops to 1 and a warning is posted. */
  QUOTA_WARN_UTILIZATION: z.coerce.number().min(0).max(1).default(0.8),

  /**
   * Homebox. The URL is not a secret; the token is. Held by the bot process
   * and handed only to the homebox-mcp subprocess, never to the agent's own
   * environment.
   */
  HOMEBOX_URL: optionalString,
  HOMEBOX_TOKEN: optionalString,
  /** Optional custom field homebox-mcp also matches identifiers against. */
  HOMEBOX_ALIAS_FIELD: optionalString,
  /** The homebox-mcp server. The image installs a pinned version on PATH. */
  HOMEBOX_MCP_COMMAND: z.string().default("homebox-mcp"),
  HOMEBOX_MCP_ARGS: z.string().default(""),

  BOX_APPROVAL_LEVEL: z.enum(APPROVAL_LEVELS).default("destructive"),

  /**
   * Files people post in Discord. Images are shown to the agent directly and
   * saved to the inbox so they can be attached to items; other files (a PDF
   * manual, a receipt) are saved for attaching and reading.
   */
  ATTACHMENT_MAX_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  ATTACHMENTS_PER_MESSAGE: z.coerce.number().int().positive().default(10),
  /** Inbox and label files older than this are deleted at startup and daily. */
  INBOX_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  /** Post labels and QR codes the agent generates back to the thread. */
  POST_GENERATED_FILES: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  /** How long an approval request waits before it counts as a refusal. */
  APPROVAL_TIMEOUT_MS: z.coerce.number().int().positive().default(15 * 60_000),

  /** IANA zone for schedules and for the date the agent is told it is. */
  BOT_TIMEZONE: z.string().default("UTC"),

  /** How often the scheduler looks for due briefs. */
  SCHEDULE_TICK_MS: z.coerce.number().int().positive().default(30_000),
  /**
   * A brief that is this late (the pod was down) is skipped rather than run:
   * a morning brief delivered at dinner is noise.
   */
  SCHEDULE_MAX_LATE_MS: z.coerce.number().int().positive().default(3 * 3_600_000),
  /** Refuse schedules that would fire more often than this. */
  SCHEDULE_MIN_INTERVAL_MIN: z.coerce.number().int().positive().default(30),

  /** How long a poll stays open if nobody answers it. Discord's minimum is 1. */
  POLL_DURATION_HOURS: z.coerce.number().int().min(1).max(768).default(24),
  /**
   * How long after the last tap before a vote is taken as final. Short for a
   * single choice — just long enough to fix a mis-tap — and longer when
   * several answers may be picked, since each one is a separate tap.
   */
  POLL_SETTLE_MS: z.coerce.number().int().nonnegative().default(4_000),
  POLL_MULTI_SETTLE_MS: z.coerce.number().int().nonnegative().default(15_000),

  /**
   * Who may cause an agent turn. Optional when the bot has its own channel:
   * Discord's permissions on a private channel already decide who can post
   * there. Required when it answers in any channel.
   */
  DISCORD_CHAT_ROLE_IDS: csv,
  DISCORD_CHAT_USER_IDS: csv,
  /** The channel(s) the bot answers in. Empty means any channel. */
  DISCORD_CHAT_CHANNEL_IDS: csv,
  /**
   * Who may press Approve. A separate list from chat on purpose: being able to
   * ask what is in the garage need not mean being able to delete it. Both empty means anyone allowed to chat may approve.
   */
  DISCORD_APPROVER_USER_IDS: csv,
  DISCORD_APPROVER_ROLE_IDS: csv,
  /** Where scheduled briefs are posted unless the schedule names a channel. */
  DISCORD_BRIEF_CHANNEL_ID: optionalString,

  HTTP_PORT: z.coerce.number().int().positive().default(8080),
  HTTP_BIND: z.string().default("0.0.0.0"),
});

const DiscordSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_EDIT_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  DISCORD_MAX_MESSAGES_PER_TURN: z.coerce.number().int().positive().default(30),
  CHAT_PENDING_MAX: z.coerce.number().int().positive().default(5),
});

type Parsed = z.infer<typeof Schema>;

export interface Config extends Parsed {
  readonly sqlitePath: string;
  readonly workDir: string;
  readonly inboxDir: string;
  readonly labelDir: string;
}

export type DiscordConfig = z.infer<typeof DiscordSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function describe(error: z.ZodError): string {
  return error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}

let cached: Config | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached && env === process.env) return cached;
  const parsed = Schema.safeParse(env);
  if (!parsed.success) throw new ConfigError(`invalid configuration:\n${describe(parsed.error)}`);
  const c = parsed.data;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: c.BOT_TIMEZONE });
  } catch {
    throw new ConfigError(`invalid configuration:\n  BOT_TIMEZONE: '${c.BOT_TIMEZONE}' is not an IANA time zone`);
  }

  const workDir = c.WORK_DIR ?? join(c.DATA_DIR, "workspace");
  const cfg: Config = {
    ...c,
    sqlitePath: c.SQLITE_PATH ?? join(c.DATA_DIR, "homeboxcordllm.db"),
    workDir,
    inboxDir: join(workDir, INBOX_DIR),
    labelDir: join(workDir, LABEL_DIR),
  };
  if (env === process.env) cached = cfg;
  return cfg;
}

export function resetConfigCache(): void {
  cached = undefined;
}

export function requireDiscord(env: NodeJS.ProcessEnv = process.env): DiscordConfig {
  const parsed = DiscordSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(`invalid Discord configuration:\n${describe(parsed.error)}`);
  return parsed.data;
}

/**
 * The environment handed to the agent subprocess.
 *
 * Deliberately a short allowlist. The Discord token and the Homebox
 * token are never in it: the bot process alone talks to Discord, and only the
 * homebox-mcp subprocess holds the Homebox token (see homebox/mcp.ts). What
 * cannot be withheld is the Anthropic credential, because the subprocess is
 * the thing that uses it.
 */
export function sanitizedEnv(
  cfg: Config,
  extra: Record<string, string> = {},
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  // Has Claude Code emit a plain-language summary after each group of tool
  // calls, which the live progress message shows instead of the calls
  // themselves. See discord/activity.ts.
  const always = { CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES: "1" };

  if (cfg.AGENT_INHERIT_ENV) {
    const inherited: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) if (v !== undefined) inherited[k] = v;
    return { ...inherited, ...always, ...extra };
  }

  const out: Record<string, string> = {
    ...always,
    PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    TZ: cfg.BOT_TIMEZONE,
  };
  if (cfg.CLAUDE_CODE_OAUTH_TOKEN) out.CLAUDE_CODE_OAUTH_TOKEN = cfg.CLAUDE_CODE_OAUTH_TOKEN;
  if (cfg.ANTHROPIC_API_KEY) out.ANTHROPIC_API_KEY = cfg.ANTHROPIC_API_KEY;
  if (cfg.ANTHROPIC_AUTH_TOKEN) out.ANTHROPIC_AUTH_TOKEN = cfg.ANTHROPIC_AUTH_TOKEN;
  // HOME is where the SDK writes session transcripts. In-cluster it is on the
  // persistent volume, which is what makes a thread resumable after a restart.
  if (env.HOME) out.HOME = env.HOME;
  return { ...out, ...extra };
}

export type CredentialSource = "oauth-token" | "api-key" | "auth-token" | "inherited-env" | "none";

/** Which credential the agent subprocess will actually use. Logged at startup. */
export function credentialSource(cfg: Config): CredentialSource {
  if (cfg.CLAUDE_CODE_OAUTH_TOKEN) return "oauth-token";
  if (cfg.ANTHROPIC_API_KEY) return "api-key";
  if (cfg.ANTHROPIC_AUTH_TOKEN) return "auth-token";
  if (cfg.AGENT_INHERIT_ENV) return "inherited-env";
  return "none";
}
