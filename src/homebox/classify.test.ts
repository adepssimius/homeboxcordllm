import { describe, expect, it } from "vitest";
import { bareBoxTool, classify, isBoxTool, needsApproval } from "./classify.js";

const hb = (t: string): string => `mcp__homebox__${t}`;

describe("classify", () => {
  it("reads are reads", () => {
    for (const t of ["search_items", "get_item", "list_locations", "location_contents", "inventory_stats", "barcode_lookup"]) {
      expect(classify(hb(t)).tier).toBe("read");
    }
  });

  it("tools that only write a local file are reads — the file path is policed separately", () => {
    for (const t of ["get_attachment", "export_csv", "generate_label", "qrcode"]) {
      expect(classify(hb(t))).toEqual({ tier: "read", reason: "only writes a local file" });
    }
  });

  it("edits are writes", () => {
    for (const t of ["create_item", "attach_document", "set_item", "move_item", "set_tags", "mark_sold", "finalize_photos"]) {
      expect(classify(hb(t)).tier).toBe("write");
    }
  });

  it("deletes and CSV import are destructive", () => {
    for (const t of ["delete_item", "delete_location", "delete_tag", "delete_attachment", "delete_maintenance", "import_csv"]) {
      expect(classify(hb(t)).tier).toBe("destructive");
    }
  });

  it("fails toward asking for a tool it has never heard of", () => {
    expect(classify(hb("reticulate_splines")).tier).toBe("write");
    expect(classify(hb("purge_everything")).tier).toBe("destructive");
  });

  it("recognises its own server's tools", () => {
    expect(isBoxTool(hb("get_item"))).toBe(true);
    expect(isBoxTool("mcp__bot__poll")).toBe(false);
    expect(bareBoxTool(hb("get_item"))).toBe("get_item");
  });
});

describe("needsApproval", () => {
  it("asks for more the stricter the level", () => {
    expect(needsApproval("write", "write")).toBe(true);
    expect(needsApproval("write", "destructive")).toBe(false);
    expect(needsApproval("destructive", "destructive")).toBe(true);
    expect(needsApproval("destructive", "none")).toBe(false);
    expect(needsApproval("read", "write")).toBe(false);
  });
});
