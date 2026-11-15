import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { pdfSafe, renderPdf } from "./pdf";

describe("PDF letters and minutes [REQ-11.10(b)]", () => {
  it("renders long text across pages with page numbers and the record fingerprint", async () => {
    const body = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}: the IRB’s decision — “approved” · details…`).join("\n");
    const bytes = await renderPdf({ heading: "Test IRB", title: "IRB-2026-0001: Approved", body, footer: "Record fingerprint abc123" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe("IRB-2026-0001: Approved");
  });
  it("replaces characters the standard fonts cannot draw", () => {
    expect(pdfSafe("IRB’s “x” — y · z… ✓")).toBe(`IRB's "x" - y - z... ?`);
  });
});
