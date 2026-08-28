export const ACCESS_TOKEN_KEY = "wq_access_token";
export const LOGIN_NOTICE_KEY = "righton.login-notice";

function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}

/** 解析 JWT payload（不校验签名，仅读 exp）。 */
export function getTokenExpiresAt(token: string | null): number | null {
  if (!token) return null;
  const payload = parseJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === "number" ? exp * 1000 : null;
}

/** 解析 JWT 中的用户名（不校验签名）。 */
export function getTokenUsername(token: string | null): string | null {
  if (!token) return null;
  const username = parseJwtPayload(token)?.username;
  return typeof username === "string" && username ? username : null;
}

/** 其他窗口改了登录 token 时通知（本窗口自己的写入不会触发）。 */
export function subscribeAuthTokenChange(onChange: (token: string | null) => void) {
  const handler = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key !== ACCESS_TOKEN_KEY && event.key !== null) return;
    onChange(getAccessToken());
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

/** 距离过期还剩多少毫秒；无效/已过期返回 0 或负数。 */
export function getTokenRemainingMs(token: string | null = getAccessToken()): number {
  const expAt = getTokenExpiresAt(token);
  if (expAt == null) return 0;
  return expAt - Date.now();
}
