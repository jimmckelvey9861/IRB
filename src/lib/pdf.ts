import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

/** Standard PDF fonts only cover WinAnsi; replace anything else so rendering never fails. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    .replace(/\t/g, "    ")
    .replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // A single word longer than the line is broken by characters.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let n = rest.length;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

export interface PdfInput {
  heading: string;
  title: string;
  body: string;
  /** Printed small at the bottom of every page, e.g. the record fingerprint. */
  footer: string;
}

/** A plain, letter-size document: heading, title, wrapped body, and a footer with page numbers. */
export async function renderPdf(input: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(input.title));
  doc.setProducer("IRB system");
  doc.setCreationDate(new Date());
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H, M, size, lead] = [612, 792, 60, 10.5, 14];
  const lines = wrap(pdfSafe(input.body), font, size, W - 2 * M);
  const footer = pdfSafe(input.footer);

  let page = doc.addPage([W, H]);
  let y = H - M;
  page.drawText(pdfSafe(input.heading), { x: M, y, size: 9, font: bold, color: rgb(0.35, 0.35, 0.35) });
  y -= 22;
  for (const l of wrap(pdfSafe(input.title), bold, 15, W - 2 * M)) {
    page.drawText(l, { x: M, y, size: 15, font: bold });
    y -= 20;
  }
  y -= 8;
  for (const l of lines) {
    if (y < M + 24) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
    page.drawText(l, { x: M, y, size, font });
    y -= lead;
  }
  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(`${footer}    Page ${i + 1} of ${pages.length}`, { x: M, y: M - 28, size: 7.5, font, color: rgb(0.4, 0.4, 0.4) }),
  );
  return doc.save();
}

export function pdfResponse(bytes: Uint8Array, filename: string): Response {
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "private, no-store",
    },
  });
}
