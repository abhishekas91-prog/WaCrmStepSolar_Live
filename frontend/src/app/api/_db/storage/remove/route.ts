import { NextResponse } from "next/server";
import { removeFiles } from "@/lib/mongo/storage";
import { serverUserContext } from "@/lib/mongo/compat";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      bucket?: string;
      paths?: string[];
    } | null;
    if (!body?.bucket || !Array.isArray(body.paths)) {
      return NextResponse.json({ error: { message: "Missing bucket or paths" } });
    }
    const ctx = await serverUserContext();
    const result = await removeFiles(ctx, body.bucket, body.paths);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({
      error: { message: String((err as Error).message ?? err) },
    });
  }
}
