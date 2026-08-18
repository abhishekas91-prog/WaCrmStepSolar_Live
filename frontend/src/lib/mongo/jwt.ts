// Pure JWT helpers — no Mongo / bcrypt imports so this module stays
// Edge-compatible (used by the middleware).
import { SignJWT, jwtVerify } from "jose";

const SECRET_UTF8 = () => new TextEncoder().encode(process.env.JWT_SECRET || "dev-only-change-me-wacrm-mongo-secret");

export async function createAccessToken(payload: {
  sub: string;
  email?: string;
  role?: string;
}): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SECRET_UTF8());
}

/** Verify a raw access token and return its `sub` claim. Null if invalid. */
export async function verifyAccessToken(token: string): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET_UTF8());
    if (!payload.sub) return null;
    return { sub: String(payload.sub) };
  } catch {
    return null;
  }
}
