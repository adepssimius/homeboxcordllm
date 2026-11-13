import { describe, expect, it } from "vitest";
import { buildCard, outcomeLine, renderDetail, summarizeCall } from "./approvalCard.js";

const hb = (t: string): string => `mcp__homebox__${t}`;
const SVC = hb("delete_item");

describe("summarizeCall", () => {
  it("names the item being deleted", () => {
    expect(summarizeCall(SVC, { identifier: "Old drill", confirm: "Old drill" })).toBe("Delete item “Old drill”");
  });

  it("says where a move goes", () => {
    expect(summarizeCall(hb("move_item"), { identifier: "000-028", location: "Garage/Shelf A" })).toBe(
      "Move “000-028” → `Garage/Shelf A`",
    );
  });

  it("counts the rows of a CSV import", () => {
    expect(summarizeCall(hb("import_csv"), { csv_text: "HB.name\nA\nB\n" })).toBe("Import items from CSV (2 rows)");
  });

  it("falls back to the tool name in words", () => {
    expect(summarizeCall(hb("reticulate_splines"), {})).toBe("Reticulate splines");
  });
});

describe("renderDetail", () => {
  it("cannot be broken out of its code fence", () => {
    const d = renderDetail({ yaml: "```\n@everyone" });
    expect(d.match(/```/g)).toHaveLength(2);
  });

  it("clips very large inputs", () => {
    expect(renderDetail({ big: "x".repeat(10_000) }).length).toBeLessThan(3700);
  });
});

describe("buildCard", () => {
  it("never offers approve-the-rest on a destructive call", () => {
    const base = { toolName: SVC, input: {}, reason: "r", toolUseId: "t" };
    expect(buildCard({ ...base, tier: "write" }).offerApproveRest).toBe(true);
    expect(buildCard({ ...base, tier: "destructive" }).offerApproveRest).toBe(false);
  });
});

describe("outcomeLine", () => {
  it("says who decided", () => {
    expect(outcomeLine({ kind: "approved", by: "42" })).toBe("✅ Approved by <@42>");
    expect(outcomeLine({ kind: "denied", by: "42" })).toBe("🚫 Denied by <@42>");
    expect(outcomeLine({ kind: "timeout", minutes: 15 })).toMatch(/15 min — not done/);
  });
});
