import { NextResponse } from "next/server";
import { readFile } from "@/lib/mongo/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SAFE_BUCKETS = new Set(["avatars", "flow-media", "chat-media", "invoices"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bucket = searchParams.get("bucket") ?? "";
  const path = searchParams.get("path") ?? "";

  if (!SAFE_BUCKETS.has(bucket) || !path) {
    return new NextResponse("Not found", { status: 404 });
  }

  const result = await readFile(bucket, path);
  if (!result) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { file } = result;
  const body = file.data.buffer
    ? Buffer.from(file.data.buffer)
    : Buffer.from(file.data as unknown as Uint8Array);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": file.content_type || "application/octet-stream",
      "Content-Length": String(file.size ?? body.byteLength),
      "Cache-Control": "public, max-age=3600",
      "Content-Disposition": `inline; filename="${path.split("/").pop() ?? "file"}"`,
    },
  });
}
