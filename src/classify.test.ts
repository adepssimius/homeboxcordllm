import { describe, expect, it } from "vitest";
import { needsApproval, toolCall } from "discordllm";
import { classify, TIERS } from "./classify.js";

const hb = (t: string) => toolCall(`mcp__homebox__${t}`, {});

describe("classify", () => {
  it("reads are reads", () => {
    for (const t of ["search_items", "get_item", "list_locations", "location_contents", "inventory_stats", "barcode_lookup"]) {
      expect(classify(hb(t))?.tier).toBe("read");
    }
  });

  it("tools that only write a local file are reads — the file path is policed separately", () => {
    for (const t of ["get_attachment", "export_csv", "generate_label", "qrcode"]) {
      expect(classify(hb(t))).toEqual({ tier: "read", reason: "only writes a local file" });
    }
  });

  it("edits are writes", () => {
    for (const t of ["create_item", "attach_document", "set_item", "move_item", "set_tags", "mark_sold", "finalize_photos"]) {
      expect(classify(hb(t))?.tier).toBe("write");
    }
  });

  it("deletes and CSV import are destructive", () => {
    for (const t of ["delete_item", "delete_location", "delete_tag", "delete_attachment", "delete_maintenance", "import_csv"]) {
      expect(classify(hb(t))?.tier).toBe("destructive");
    }
  });

  it("fails toward asking for a tool it has never heard of", () => {
    expect(classify(hb("reticulate_splines"))?.tier).toBe("write");
    expect(classify(hb("purge_everything"))?.tier).toBe("destructive");
  });

  it("says nothing about tools that are not Homebox's", () => {
    expect(classify(toolCall("mcp__bot__poll", {}))).toBeUndefined();
    expect(classify(toolCall("Read", {}))).toBeUndefined();
  });
});

describe("the approval level", () => {
  it("asks for more the stricter it is", () => {
    expect(needsApproval(TIERS, "write", "write")).toBe(true);
    expect(needsApproval(TIERS, "write", "destructive")).toBe(false);
    expect(needsApproval(TIERS, "destructive", "destructive")).toBe(true);
    expect(needsApproval(TIERS, "destructive", "none")).toBe(false);
    expect(needsApproval(TIERS, "read", "write")).toBe(false);
  });
});
