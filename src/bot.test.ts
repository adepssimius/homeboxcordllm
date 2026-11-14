import { describe, expect, it, vi } from "vitest";
import { toolCall, type Config, type Domain, type Logger } from "discordllm";
import bot from "./bot.js";

const ws = "/data/workspace";
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const cfg = { name: "default", workDir: ws, inboxDir: `${ws}/inbox`, INBOX_RETENTION_DAYS: 30, POST_GENERATED_FILES: true } as Config;

async function domain(env: Record<string, string | undefined> = {}): Promise<Domain> {
  return bot.setup({
    cfg,
    log,
    shared: undefined,
    sessions: { byId: async () => undefined },
    env: {
      HOMEBOX_URL: "http://homebox.test",
      HOMEBOX_TOKEN: "hb-secret",
      HOMEBOX_ALIAS_FIELD: undefined,
      HOMEBOX_MCP_COMMAND: "homebox-mcp",
      HOMEBOX_MCP_ARGS: "",
      ...env,
    },
  });
}

const call = (d: Domain, tool: string, input: unknown) =>
  d.policy!({ ...toolCall(`mcp__homebox__${tool}`, input), workDir: ws, interactive: true });

describe("the Homebox server", () => {
  it("gets the token, and the agent's own environment does not", async () => {
    const d = await domain();
    expect(d.servers.homebox).toMatchObject({ type: "stdio", command: "homebox-mcp", env: { HOMEBOX_TOKEN: "hb-secret" } });
    expect(d.agentEnv).toBeUndefined();
    expect(bot.secrets).toContain("HOMEBOX_TOKEN");
  });

  it("is left out when it is not configured, so the bot starts and says so", async () => {
    expect((await domain({ HOMEBOX_TOKEN: undefined })).servers).toEqual({});
  });

  it("writes labels where the bot posts them from", async () => {
    const d = await domain();
    expect((d.servers.homebox as { env: Record<string, string> }).env.HOMEBOX_LABEL_DIR).toBe(`${ws}/labels`);
    expect(d.postFilesFrom).toEqual([`${ws}/labels`]);
  });
});

describe("homebox-mcp's file arguments are held to the workspace", () => {
  it("attaches a posted photo by its workspace path", async () => {
    const d = await domain();
    expect(call(d, "attach_document", { identifier: "Drill", source: "inbox/s/1-1-drill.jpg", title: "x" }).allow).toBe(true);
    expect(call(d, "attach_document", { identifier: "Drill", source: `${ws}/inbox/s/1-1-drill.jpg`, title: "x" }).allow).toBe(true);
  });

  it("attaches a manual by URL", async () => {
    expect(call(await domain(), "attach_document", { identifier: "Drill", source: "https://example.com/manual.pdf", title: "x" }).allow).toBe(true);
  });

  it("refuses to upload a file from outside the workspace — the token would leak into Homebox", async () => {
    const d = await domain();
    for (const source of ["/proc/self/environ", "../homeboxcordllm.db", "~/.ssh/id_rsa", "/etc/passwd"]) {
      expect(call(d, "attach_document", { identifier: "Drill", source, title: "x" }).allow).toBe(false);
    }
  });

  it("refuses to write a download, export or label outside the workspace", async () => {
    const d = await domain();
    expect(call(d, "get_attachment", { identifier: "x", attachment_id: "y", save_to: "/etc" }).allow).toBe(false);
    expect(call(d, "export_csv", { save_to: "/data/x.csv" }).allow).toBe(false);
    expect(call(d, "generate_label", { identifier: "x", out_dir: "/tmp/../data" }).allow).toBe(false);
    expect(call(d, "qrcode", { data: "x", out_dir: "labels" }).allow).toBe(true);
    expect(call(d, "export_csv", {}).allow).toBe(true);
  });

  it("only exempts a URL where homebox-mcp takes one", async () => {
    // Anywhere else a URL-looking value is a path like any other, and this one climbs out.
    const d = await domain();
    expect(call(d, "export_csv", { save_to: "https://x/../../../etc/cron.d" }).allow).toBe(false);
    expect(call(d, "attach_document", { identifier: "x", source: "https://x/../../../etc/cron.d" }).allow).toBe(true);
  });

  it("confines a path-like argument on a tool nobody listed yet", async () => {
    const d = await domain();
    expect(call(d, "import_photos", { folder_path: "/etc" }).allow).toBe(false);
    expect(call(d, "import_photos", { folder_path: "inbox/s" }).allow).toBe(true);
  });
});

describe("the definition", () => {
  it("has no shell and takes posted files", () => {
    expect(bot.shell).toBeUndefined();
    expect(bot.attachments).toBe(true);
    expect(bot.tiers).toEqual(["read", "write", "destructive"]);
  });

  it("still reads the old name for the approval level", () => {
    expect(bot.envAliases).toMatchObject({ BOX_APPROVAL_LEVEL: "APPROVAL_LEVEL" });
  });
});
