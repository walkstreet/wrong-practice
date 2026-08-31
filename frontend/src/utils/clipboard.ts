/** 复制到剪贴板。安全上下文走 Clipboard API，失败时回退 execCommand。 */
export async function copyText(text: string): Promise<boolean> {
  const value = text ?? "";
  if (!value) return false;

  if (typeof navigator !== "undefined" && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* 权限被拒或焦点丢失时走回退 */
    }
  }

  try {
    const el = document.createElement("textarea");
    el.value = value;
    el.setAttribute("readonly", "");
    el.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;";
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
