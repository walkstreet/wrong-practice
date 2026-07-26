const TOKEN_KEY = "wq_access_token";

export function getAccessToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** 解析 JWT payload（不校验签名，仅读 exp）。 */
export function getTokenExpiresAt(token: string | null): number | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    const exp = payload?.exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** 距离过期还剩多少毫秒；无效/已过期返回 0 或负数。 */
export function getTokenRemainingMs(token: string | null = getAccessToken()): number {
  const expAt = getTokenExpiresAt(token);
  if (expAt == null) return 0;
  return expAt - Date.now();
}
