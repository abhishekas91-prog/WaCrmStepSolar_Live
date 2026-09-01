import { NextResponse } from "next/server";
import { uploadFile } from "@/lib/mongo/storage";
import { serverUserContext } from "@/lib/mongo/compat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const bucket = String(form.get("bucket") ?? "");
    const path = String(form.get("path") ?? "");
    const contentType = String(form.get("contentType") ?? "") || undefined;
    const upsert = String(form.get("upsert") ?? "") === "true";
    const file = form.get("file");
    if (!bucket || !path || !file) {
      return NextResponse.json({
        data: null,
        error: { message: "Missing bucket, path or file" },
      });
    }
    const bytes = Buffer.from(await (file as Blob).arrayBuffer());
    const ctx = await serverUserContext();
    const result = await uploadFile(ctx, bucket, path, bytes, { contentType, upsert });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({
      data: null,
      error: { message: String((err as Error).message ?? err) },
    });
  }
}
