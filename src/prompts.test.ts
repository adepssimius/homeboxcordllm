import { describe, expect, it } from "vitest";
import { systemAppend } from "./prompts.js";

const sys = (over: Partial<Parameters<typeof systemAppend>[0]> = {}) =>
  systemAppend({
    timeZone: "America/New_York",
    hasHomebox: true,
    approvalLevel: "destructive",
    botTool: (n) => `mcp__bot__${n}`,
    notesFile: "CLAUDE.md",
    inboxDir: "inbox",
    labelDir: "labels",
    ...over,
  });

describe("systemAppend", () => {
  it("explains that the approval button is the question", () => {
    const s = sys();
    expect(s).toMatch(/the button is the question/);
    expect(s).toMatch(/Do not retry it, and do not reach the\s+same result another way/);
  });

  it("describes each approval level differently", () => {
    const texts = ["write", "destructive", "none"].map((l) => sys({ approvalLevel: l }));
    expect(new Set(texts).size).toBe(3);
  });

  it("says plainly when Homebox is not connected", () => {
    const s = sys({ hasHomebox: false });
    expect(s).toMatch(/No Homebox tools are connected/);
    expect(s).not.toMatch(/### Approval/);
  });

  it("explains where posted photos are and how to attach them", () => {
    const s = sys();
    expect(s).toContain("`inbox/`");
    expect(s).toMatch(/attach_document/);
    expect(s).toMatch(/finalize_photos/);
  });

  it("tells the agent to keep secrets out of the notes", () => {
    expect(sys()).toMatch(/Never write a token, password or other secret/);
  });

  it("names the bot's own tools by the names the library gives them", () => {
    const named = [...sys().matchAll(/`mcp__bot__(\w+)`/g)].map((m) => m[1]);
    expect(new Set(named)).toEqual(new Set(["schedule_set", "schedule_list", "schedule_delete", "schedule_run_now", "poll"]));
  });
});
