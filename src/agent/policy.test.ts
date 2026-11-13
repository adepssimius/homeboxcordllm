import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate } from "./policy.js";

const ws = "/data/workspace";
const call = (toolName: string, toolInput: unknown, opts: { interactive?: boolean; aborted?: boolean } = {}) =>
  evaluate({
    toolName,
    toolInput,
    workDir: ws,
    interactive: opts.interactive ?? true,
    aborted: opts.aborted ?? false,
  });
const hb = (t: string): string => `mcp__homebox__${t}`;

describe("files stay inside the workspace", () => {
  it("allows editing the notes, relative or absolute", () => {
    expect(call("Edit", { file_path: "CLAUDE.md" }).allow).toBe(true);
    expect(call("Write", { file_path: `${ws}/drafts/import.csv` }).allow).toBe(true);
  });

  it("allows reading a posted photo", () => {
    expect(call("Read", { file_path: "inbox/abc/123-1-IMG_0001.HEIC" }).allow).toBe(true);
  });

  it("allows scratch files under the temp directory", () => {
    expect(call("Write", { file_path: join(tmpdir(), "x.json") }).allow).toBe(true);
  });

  it("refuses the database and anything else on the volume", () => {
    expect(call("Write", { file_path: "/data/homeboxcordllm.db" }).allow).toBe(false);
    expect(call("Edit", { file_path: "../homeboxcordllm.db" }).allow).toBe(false);
    // Shares a prefix with the workspace; a startsWith check would pass it.
    expect(call("Write", { file_path: "/data/workspace-other/x" }).allow).toBe(false);
  });

  it("refuses reading outside it — another process's environment included", () => {
    expect(call("Read", { file_path: "/proc/1/environ" }).allow).toBe(false);
    expect(call("Grep", { pattern: "TOKEN", path: "/proc" }).allow).toBe(false);
    expect(call("Glob", { pattern: "**/*", path: "/data" }).allow).toBe(false);
  });

  it("refuses a write with no path", () => {
    expect(call("Write", { content: "x" }).allow).toBe(false);
  });
});

describe("homebox-mcp's file arguments are held to the same rule", () => {
  it("attaches a posted photo by its workspace path", () => {
    expect(call(hb("attach_document"), { identifier: "Drill", source: "inbox/s/1-1-drill.jpg", title: "x" }).allow).toBe(true);
    expect(call(hb("attach_document"), { identifier: "Drill", source: `${ws}/inbox/s/1-1-drill.jpg`, title: "x" }).allow).toBe(true);
  });

  it("attaches a manual by URL", () => {
    expect(call(hb("attach_document"), { identifier: "Drill", source: "https://example.com/manual.pdf", title: "x" }).allow).toBe(true);
  });

  it("refuses to upload a file from outside the workspace — the token would leak into Homebox", () => {
    for (const source of ["/proc/self/environ", "../homeboxcordllm.db", "~/.ssh/id_rsa", "/etc/passwd"]) {
      expect(call(hb("attach_document"), { identifier: "Drill", source, title: "x" }).allow).toBe(false);
    }
  });

  it("refuses to write a download, export or label outside the workspace", () => {
    expect(call(hb("get_attachment"), { identifier: "x", attachment_id: "y", save_to: "/etc" }).allow).toBe(false);
    expect(call(hb("export_csv"), { save_to: "/data/x.csv" }).allow).toBe(false);
    expect(call(hb("generate_label"), { identifier: "x", out_dir: "/tmp/../data" }).allow).toBe(false);
    expect(call(hb("qrcode"), { data: "x", out_dir: "labels" }).allow).toBe(true);
    expect(call(hb("export_csv"), {}).allow).toBe(true);
  });
});

describe("a tool nobody listed yet", () => {
  it("still has its path-like arguments confined", () => {
    expect(call(hb("import_photos"), { folder_path: "/etc" }).allow).toBe(false);
    expect(call(hb("import_photos"), { folder_path: "inbox/s" }).allow).toBe(true);
  });
});

describe("there is no shell", () => {
  it("refuses Bash even if it were registered", () => {
    expect(call("Bash", { command: "env" }).allow).toBe(false);
  });
});

describe("scheduled runs only look", () => {
  it("allows reads", () => {
    expect(call(hb("warranties_expiring"), {}, { interactive: false }).allow).toBe(true);
  });

  it("refuses any change", () => {
    const d = call(hb("set_item"), { identifier: "Drill" }, { interactive: false });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason).toMatch(/scheduled run only looks/);
  });

  it("leaves interactive calls to the approval step", () => {
    expect(call(hb("set_item"), {}).allow).toBe(true);
    expect(call(hb("delete_item"), {}).allow).toBe(true);
  });
});

describe("stop", () => {
  it("refuses everything once the run is stopped", () => {
    expect(call(hb("get_item"), {}, { aborted: true }).allow).toBe(false);
  });
});
