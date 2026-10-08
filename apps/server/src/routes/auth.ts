import { Hono } from "hono";
import { z } from "zod";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
} from "../auth/session";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const passwordSchema = z
  .object({ oldPassword: z.string().min(1), newPassword: z.string().min(8) });

function publicUser(u: { id: number; username: string }) {
  return { id: u.id, username: u.username };
}

export const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "参数错误" }, 400);
  const { username, password } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  if (!user || !(await Bun.password.verify(password, user.passwordHash))) {
    return c.json({ error: "用户名或密码错误" }, 401);
  }

  setCookie(c, SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions);
  return c.json({ user: publicUser(user) });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/me", (c) => {
  const session = verifySessionToken(getCookie(c, SESSION_COOKIE));
  if (!session) return c.json({ error: "未登录" }, 401);
  return c.json({ userId: session.uid });
});

authRoutes.put("/password", async (c) => {
  const session = verifySessionToken(getCookie(c, SESSION_COOKIE));
  if (!session) return c.json({ error: "未登录" }, 401);

  const parsed = passwordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "新密码至少 8 位" }, 400);

  const [user] = await db.select().from(users).where(eq(users.id, session.uid)).limit(1);
  if (!user || !(await Bun.password.verify(parsed.data.oldPassword, user.passwordHash))) {
    return c.json({ error: "旧密码错误" }, 401);
  }

  const newHash = await Bun.password.hash(parsed.data.newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date().toISOString() })
    .where(eq(users.id, user.id));
  return c.json({ ok: true });
});
