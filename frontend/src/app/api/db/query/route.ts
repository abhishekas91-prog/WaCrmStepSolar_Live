import { NextResponse } from "next/server";
import { executeQuery, type BuilderState } from "@/lib/mongo/query-builder";
import { serverUserContext } from "@/lib/mongo/compat";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      state?: BuilderState;
    } | null;
    if (!body?.state || !body.state.table) {
      return NextResponse.json(
        { data: null, count: null, error: { message: "Missing query state" } },
        { status: 400 },
      );
    }
    const ctx = await serverUserContext();
    const result = await executeQuery(body.state, ctx);
    return NextResponse.json({
      data: result.data,
      count: result.count,
      error: result.error,
    });
  } catch (err) {
    return NextResponse.json({
      data: null,
      count: null,
      error: { message: String((err as Error).message ?? err) },
    });
  }
}
