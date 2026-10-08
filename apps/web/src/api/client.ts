const BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    // 统一跳转登录
    if (!location.pathname.startsWith("/login")) {
      location.href = "/login";
    }
    throw new ApiError(401, "未登录或登录已过期");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (data as any)?.error ?? `请求失败 (${res.status})`);
  }
  return data as T;
}

export const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
