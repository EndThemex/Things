import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE, verifySessionToken } from "../auth/session";

export async function authMiddleware(c: Context, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  const session = verifySessionToken(token);
  if (!session) {
    return c.json({ error: "未登录或登录已过期" }, 401);
  }
  c.set("userId", session.uid);
  await next();
}
