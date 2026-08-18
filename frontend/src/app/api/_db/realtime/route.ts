import { NextResponse } from "next/server";
import { pollChanges } from "@/lib/mongo/realtime";
import { serverUserContext } from "@/lib/mongo/compat";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      table?: string;
      since?: number | null;
    } | null;
    if (!body?.table) {
      return NextResponse.json({ events: [], cursor: null });
    }
    const ctx = await serverUserContext();
    const result = await pollChanges(ctx.user ?? null, {
      table: body.table,
      since: typeof body.since === "number" ? body.since : null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({
      events: [],
      cursor: null,
      error: { message: String((err as Error).message ?? err) },
    });
  }
}
