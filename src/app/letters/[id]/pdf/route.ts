import { eq } from "drizzle-orm";
import { db } from "@/db";
import { letters } from "@/db/schema";
import { apiUser } from "@/lib/auth/api";
import { IRB_NAME } from "@/lib/meetings";
import { pdfResponse, renderPdf } from "@/lib/pdf";
import { getSubmissionForViewer } from "@/lib/submissions";

export async function GET(_req: Request, ctx: RouteContext<"/letters/[id]/pdf">) {
  const user = await apiUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { id } = await ctx.params;
  const [letter] = await db.select().from(letters).where(eq(letters.id, id)).limit(1);
  if (!letter) return new Response("Not found.", { status: 404 });
  try {
    await getSubmissionForViewer(db, user, letter.submissionId);
  } catch {
    return new Response("Not found.", { status: 404 });
  }
  const bytes = await renderPdf({
    heading: IRB_NAME,
    title: letter.subject,
    body: letter.body,
    footer: `Issued ${letter.issuedAt.toISOString().slice(0, 16).replace("T", " ")} UTC - record fingerprint ${letter.bodyHash.slice(0, 16)}`,
  });
  return pdfResponse(bytes, `${letter.subject.split(":")[0]}-letter.pdf`);
}
