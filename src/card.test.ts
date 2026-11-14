import { describe, expect, it } from "vitest";
import { toolCall } from "discordllm";
import { summarizeCall } from "./card.js";

const hb = (t: string, input: unknown) => toolCall(`mcp__homebox__${t}`, input);

describe("summarizeCall", () => {
  it("names the item being deleted", () => {
    expect(summarizeCall(hb("delete_item", { identifier: "Old drill", confirm: "Old drill" }))).toBe("Delete item “Old drill”");
  });

  it("says where a move goes", () => {
    expect(summarizeCall(hb("move_item", { identifier: "000-028", location: "Garage/Shelf A" }))).toBe(
      "Move “000-028” → `Garage/Shelf A`",
    );
  });

  it("counts the rows of a CSV import", () => {
    expect(summarizeCall(hb("import_csv", { csv_text: "HB.name\nA\nB\n" }))).toBe("Import items from CSV (2 rows)");
  });

  it("falls back to the tool name in words", () => {
    expect(summarizeCall(hb("reticulate_splines", {}))).toBe("Reticulate splines");
  });

  it("leaves other servers' calls to the library", () => {
    expect(summarizeCall(toolCall("mcp__bot__poll", {}))).toBeUndefined();
  });
});
