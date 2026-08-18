import { NextResponse } from "next/server";
import { confirmRecovery } from "@/lib/mongo/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", request.url));
  }

  const { error } = await confirmRecovery(token);

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=invalid_recovery_link`, request.url),
    );
  }

  return NextResponse.redirect(new URL("/reset-password", request.url));
}
