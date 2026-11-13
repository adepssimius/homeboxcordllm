import { describe, expect, it } from "vitest";
import { botToolNames } from "../tools/bot.js";
import {
  briefUserPrompt,
  chatUserPrompt,
  localStamp,
  pollAnswerContent,
  stripTurnHeader,
  systemAppend,
  turnHeader,
} from "./prompts.js";

const sys = (over: Partial<Parameters<typeof systemAppend>[0]> = {}) =>
  systemAppend({
    timeZone: "America/New_York",
    hasHomebox: true,
    approvalLevel: "destructive",
    notesFile: "CLAUDE.md",
    inboxDir: "inbox",
    labelDir: "labels",
    ...over,
  });

const turn = { now: new Date("2026-10-02T10:31:00Z"), timeZone: "America/New_York" };

describe("systemAppend", () => {
  it("explains that the approval button is the question", () => {
    const s = sys();
    expect(s).toMatch(/the button is the question/);
    expect(s).toMatch(/Do not retry it, and do not reach the\s+same result another way/);
  });

  it("describes each approval level differently", () => {
    const texts = (["write", "destructive", "none"] as const).map((l) => sys({ approvalLevel: l }));
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

  it("only names bot tools that exist", () => {
    const named = [...sys().matchAll(/`mcp__bot__(\w+)`/g)].map((m) => `mcp__bot__${m[1]}`);
    expect(named.length).toBeGreaterThan(0);
    const real = new Set(botToolNames(true));
    for (const n of named) expect(real.has(n)).toBe(true);
  });
});

describe("turn header", () => {
  it("states the local time", () => {
    expect(turnHeader(turn)).toContain("Friday 2026-10-02 06:31 (America/New_York)");
  });

  it("does not open with a tag, or the SDK will not list the session for resume", () => {
    expect(chatUserPrompt({ authorDisplayName: "Ben", content: "hi" }, turn).charAt(0)).not.toBe("<");
    expect(briefUserPrompt({ name: "x", prompt: "y" }, turn).charAt(0)).not.toBe("<");
  });

  it("is stripped back out of a stored prompt", () => {
    const p = chatUserPrompt({ authorDisplayName: "Ben", content: "where is the drill?" }, turn);
    expect(stripTurnHeader(p)).toBe("Ben says:\n\nwhere is the drill?");
  });
});

describe("chatUserPrompt", () => {
  it("includes messages that arrived while the last run was going", () => {
    const p = chatUserPrompt({ authorDisplayName: "Ben", content: "turn off the porch", coalescedWith: ["and the hall"] }, turn);
    expect(p).toMatch(/They then added, before you replied:\n\nand the hall/);
  });
});

describe("posted files", () => {
  const files = [
    { path: "inbox/s/1-1-drill.jpg", name: "drill.jpg", contentType: "image/jpeg", bytes: 2_400_000, image: true },
    { path: "inbox/s/1-2-IMG_9.HEIC", name: "IMG_9.HEIC", contentType: "image/heic", bytes: 900_000, image: true },
    { path: "inbox/s/1-3-manual.pdf", name: "manual.pdf", contentType: "application/pdf", bytes: 40_000, image: false },
  ];

  it("lists each file with its path and whether it is already visible", () => {
    const p = chatUserPrompt(
      { authorDisplayName: "Ben", content: "add this", files, shown: new Set(["inbox/s/1-1-drill.jpg"]) },
      turn,
    );
    expect(p).toContain("`inbox/s/1-1-drill.jpg` — “drill.jpg”, image/jpeg, 2.3 MB; shown below as image 1");
    expect(p).toMatch(/1-2-IMG_9\.HEIC.*not shown — Read it/);
    expect(p).toMatch(/1-3-manual\.pdf.*Read it if you need its contents/);
  });

  it("says when a photo came with no text", () => {
    const p = chatUserPrompt({ authorDisplayName: "Ben", content: "", files, shown: new Set() }, turn);
    expect(p).toContain("(no text — just the files below)");
  });

  it("reports files that were not saved", () => {
    const p = chatUserPrompt({ authorDisplayName: "Ben", content: "x", skippedFiles: ["clip.mp4: video files aren't used"] }, turn);
    expect(p).toMatch(/Not saved:\n- clip\.mp4/);
  });

  it("adds nothing when nothing was posted", () => {
    expect(chatUserPrompt({ authorDisplayName: "Ben", content: "hi" }, turn)).not.toMatch(/Files they posted/);
  });
});

describe("briefUserPrompt", () => {
  it("says a scheduled run only looks", () => {
    const p = briefUserPrompt({ name: "morning", prompt: "anything unusual?" }, turn);
    expect(p).toMatch(/This run only looks/);
    expect(p.endsWith("anything unusual?")).toBe(true);
  });
});

describe("pollAnswerContent", () => {
  it("names the poll and the answer", () => {
    expect(pollAnswerContent({ key: "rooms", question: "Which rooms?" }, ["Kitchen", "Hall"])).toContain(
      "Answers:\n- Kitchen\n- Hall",
    );
  });
});

describe("localStamp", () => {
  it("formats in the given zone", () => {
    expect(localStamp(new Date("2026-01-01T05:00:00Z"), "UTC")).toBe("Thursday 2026-01-01 05:00");
  });
});
