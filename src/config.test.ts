import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, sanitizedEnv } from "./config.js";

const env = (o: Record<string, string> = {}): NodeJS.ProcessEnv => ({ DATA_DIR: "/tmp/box-test", ...o });

describe("loadConfig", () => {
  it("derives the database, workspace, inbox and label paths from DATA_DIR", () => {
    const c = loadConfig(env());
    expect(c.sqlitePath).toBe("/tmp/box-test/homeboxcordllm.db");
    expect(c.workDir).toBe("/tmp/box-test/workspace");
    expect(c.inboxDir).toBe("/tmp/box-test/workspace/inbox");
    expect(c.labelDir).toBe("/tmp/box-test/workspace/labels");
  });

  it("asks for approval only on destructive calls by default", () => {
    expect(loadConfig(env()).BOX_APPROVAL_LEVEL).toBe("destructive");
  });

  it("reads lists, trimming whitespace", () => {
    expect(loadConfig(env({ DISCORD_APPROVER_USER_IDS: "1, 2," })).DISCORD_APPROVER_USER_IDS).toEqual(["1", "2"]);
  });

  it("treats an empty ConfigMap value as unset", () => {
    expect(loadConfig(env({ HOMEBOX_URL: "" })).HOMEBOX_URL).toBeUndefined();
  });

  it("refuses an approval level that does not exist", () => {
    expect(() => loadConfig(env({ BOX_APPROVAL_LEVEL: "change" }))).toThrow(ConfigError);
  });

  it("refuses a time zone that does not exist", () => {
    expect(() => loadConfig(env({ BOT_TIMEZONE: "Mars/Olympus" }))).toThrow(/BOT_TIMEZONE/);
  });

  it("has no shell among the default built-in tools", () => {
    expect(loadConfig(env()).AGENT_BUILTIN_TOOLS).not.toContain("Bash");
  });
});

describe("sanitizedEnv", () => {
  it("never carries the Discord or Homebox token", () => {
    const c = loadConfig(env({ HOMEBOX_TOKEN: "hb-secret", CLAUDE_CODE_OAUTH_TOKEN: "oauth" }));
    const out = sanitizedEnv(c, {}, { PATH: "/bin", DISCORD_BOT_TOKEN: "discord-secret", HOMEBOX_TOKEN: "hb-secret" });
    const all = JSON.stringify(out);
    expect(all).not.toContain("discord-secret");
    expect(all).not.toContain("hb-secret");
    expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth");
  });
});
