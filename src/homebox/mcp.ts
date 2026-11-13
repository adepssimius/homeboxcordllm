import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { Config } from "../config.js";
import { BOX_SERVER } from "./classify.js";

/**
 * The Homebox MCP server ([homebox-mcp](https://github.com/dgahagan/homebox-mcp)),
 * run as a stdio subprocess of the agent.
 *
 * Defined here rather than read from any `.mcp.json`: `strictMcpConfig` in
 * agent/options.ts makes this the whole list. The token goes into this
 * server's environment and nowhere else — the agent's own environment
 * (config.ts `sanitizedEnv`) does not carry it, and the agent has no shell to
 * go looking for it.
 *
 * homebox-mcp also reads a `.env` next to its own module file. In the image
 * that is inside the read-only venv, where none exists.
 */
export function boxServer(cfg: Config): Record<string, McpServerConfig> {
  if (!cfg.HOMEBOX_URL || !cfg.HOMEBOX_TOKEN) return {};
  return {
    [BOX_SERVER]: {
      type: "stdio",
      command: cfg.HOMEBOX_MCP_COMMAND,
      args: cfg.HOMEBOX_MCP_ARGS.split(/\s+/).filter((a) => a.length > 0),
      env: {
        HOMEBOX_URL: cfg.HOMEBOX_URL,
        HOMEBOX_TOKEN: cfg.HOMEBOX_TOKEN,
        ...(cfg.HOMEBOX_ALIAS_FIELD ? { HOMEBOX_ALIAS_FIELD: cfg.HOMEBOX_ALIAS_FIELD } : {}),
        // Labels and QR codes land in the workspace, where the agent can see
        // them and the bot can post them to Discord.
        HOMEBOX_LABEL_DIR: cfg.labelDir,
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME ?? "/tmp",
      },
    },
  };
}
