import { NextResponse } from "next/server";
import { proxyAuthAction } from "@/lib/mongo/compat";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: string;
      [key: string]: unknown;
    } | null;
    if (!body?.action) {
      return NextResponse.json({ error: { message: "Missing action" } }, { status: 400 });
    }
    const { action, ...payload } = body;
    const result = await proxyAuthAction(String(action), payload);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({
      error: { message: String((err as Error).message ?? err) },
    });
  }
}
