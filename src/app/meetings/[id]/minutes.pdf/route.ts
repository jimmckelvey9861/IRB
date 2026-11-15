import { eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings, signatures } from "@/db/schema";
import { apiUser } from "@/lib/auth/api";
import { signatureManifestation } from "@/lib/esign";
import { IRB_NAME } from "@/lib/meetings";
import { pdfResponse, renderPdf } from "@/lib/pdf";

export async function GET(_req: Request, ctx: RouteContext<"/meetings/[id]/minutes.pdf">) {
  const user = await apiUser();
  if (!user || !user.roles.some((r) => r !== "investigator")) return new Response("Not allowed.", { status: 401 });
  const { id } = await ctx.params;
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!m?.minutes) return new Response("No signed minutes for this meeting.", { status: 404 });
  const [sig] = m.minutesSignatureId ? await db.select().from(signatures).where(eq(signatures.id, m.minutesSignatureId)).limit(1) : [];
  const bytes = await renderPdf({
    heading: IRB_NAME,
    title: `Minutes of the meeting of ${m.scheduledStart.toISOString().slice(0, 10)}`,
    body: m.minutes + (sig ? `\n\n${signatureManifestation(sig)}` : ""),
    footer: `Record fingerprint ${m.minutesHash?.slice(0, 16)}`,
  });
  return pdfResponse(bytes, `minutes-${m.scheduledStart.toISOString().slice(0, 10)}.pdf`);
}
