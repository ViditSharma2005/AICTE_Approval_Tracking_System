import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import type { Role } from "./constants";

const SESSION_COOKIE = "session";
const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET || "aicte-dev-fallback-secret-please-set-SESSION_SECRET",
);

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  designation: string | null;
  regionId: string | null;
  institutionId: string | null;
};

export async function createSession(userId: string) {
  const token = await new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);

  // Mark the session cookie Secure only when the request actually arrived over
  // HTTPS, so a production build served on http://localhost still lets you log
  // in. Force it either way with COOKIE_SECURE=true|false.
  const h = await headers();
  const isHttps = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
  const explicit = process.env.COOKIE_SECURE;
  const secure = explicit === "true" ? true : explicit === "false" ? false : isHttps;

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Cached per request — safe to call from many components on one render. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secret);
    const userId = payload.userId as string | undefined;
    if (!userId) return null;

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        designation: true,
        regionId: true,
        institutionId: true,
      },
    });
    if (!user) return null;
    return { ...user, role: user.role as Role };
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}
