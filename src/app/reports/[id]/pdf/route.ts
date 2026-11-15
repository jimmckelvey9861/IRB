import { eq } from "drizzle-orm";
import { db } from "@/db";
import { regulatoryReports, signatures } from "@/db/schema";
import { REPORT_LABELS } from "@/domain/oversight";
import { apiUser } from "@/lib/auth/api";
import { signatureManifestation } from "@/lib/esign";
import { IRB_NAME } from "@/lib/meetings";
import { pdfResponse, renderPdf } from "@/lib/pdf";

export async function GET(_req: Request, ctx: RouteContext<"/reports/[id]/pdf">) {
  const user = await apiUser();
  if (!user || !user.roles.some((r) => r !== "investigator")) return new Response("Not allowed.", { status: 401 });
  const { id } = await ctx.params;
  const [r] = await db.select().from(regulatoryReports).where(eq(regulatoryReports.id, id)).limit(1);
  if (!r) return new Response("Not found.", { status: 404 });
  const [sig] = r.signatureId ? await db.select().from(signatures).where(eq(signatures.id, r.signatureId)).limit(1) : [];
  const bytes = await renderPdf({
    heading: IRB_NAME + (r.status === "draft" ? " - DRAFT, NOT YET SIGNED" : ""),
    title: REPORT_LABELS[r.kind],
    body: r.body + (sig ? `\n\n${signatureManifestation(sig)}` : ""),
    footer: `Record fingerprint ${r.bodyHash.slice(0, 16)}`,
  });
  return pdfResponse(bytes, `report-${r.kind}.pdf`);
}
