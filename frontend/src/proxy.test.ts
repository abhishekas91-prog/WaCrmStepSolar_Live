import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAccessToken } from "@/lib/mongo/jwt";

const { proxy } = await import("./proxy");
const { AUTH_COOKIE } = await import("@/lib/mongo/auth");

async function sessionCookie(): Promise<string> {
  const token = await createAccessToken({ sub: "user-1" });
  return Buffer.from(JSON.stringify({ access_token: token })).toString("base64url");
}

beforeEach(() => {
  process.env.JWT_SECRET = "test-secret";
  vi.restoreAllMocks();
});

afterEach(() => vi.clearAllMocks());

describe("proxy — auth redirects and guards", () => {
  it("redirects a signed-in user off /login to /dashboard", async () => {
    const cookie = await sessionCookie();
    const res = await proxy(
      new NextRequest("https://app.test/login", { headers: { cookie: `${AUTH_COOKIE}=${cookie}` } }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/inbox");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    const cookie = await sessionCookie();
    const res = await proxy(
      new NextRequest("https://app.test/login?invite=abc123", {
        headers: { cookie: `${AUTH_COOKIE}=${cookie}` },
      }),
    );
    expect(res.headers.get("location")).toContain("/join/abc123");
  });

  it("redirects an anonymous user on a protected page to /login", async () => {
    const res = await proxy(new NextRequest("https://app.test/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("passes through for a signed-in user on a protected page", async () => {
    const cookie = await sessionCookie();
    const res = await proxy(
      new NextRequest("https://app.test/dashboard", {
        headers: { cookie: `${AUTH_COOKIE}=${cookie}` },
      }),
    );
    expect(res.headers.get("location")).toBeNull();
  });

  it("rejects anonymous /api/whatsapp calls that are not webhooks", async () => {
    const res = await proxy(new NextRequest("https://app.test/api/whatsapp/send"));
    expect(res.status).toBe(401);
  });

  it("does not block webhook endpoints", async () => {
    const res = await proxy(new NextRequest("https://app.test/api/whatsapp/webhook"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("treats a tampered cookie as anonymous", async () => {
    const res = await proxy(
      new NextRequest("https://app.test/dashboard", {
        headers: { cookie: `${AUTH_COOKIE}=not-a-real-cookie` },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
