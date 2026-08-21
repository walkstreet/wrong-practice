import { Button, Form, Input, message } from "antd";
import axios from "axios";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { login } from "../api";
import { setAccessToken } from "../auth";
import AppLogo from "../components/AppLogo";

interface FormValues {
  username: string;
  password: string;
}

const BACKGROUNDS = [
  { key: "forest1", src: "/forest.jpg" },
  { key: "forest2", src: "/forest2.jpg" },
] as const;

const CUSTOM_BG_KEY = "login-bg-custom";

function loadInitialBg() {
  try {
    const saved = localStorage.getItem("login-bg");
    if (saved === "custom") {
      const dataUrl = localStorage.getItem(CUSTOM_BG_KEY);
      if (dataUrl) return { key: "custom", src: dataUrl };
    }
    const found = BACKGROUNDS.find((b) => b.key === saved);
    if (found) return { key: found.key, src: found.src };
  } catch {}
  return { key: BACKGROUNDS[0].key, src: BACKGROUNDS[0].src };
}

function loadCustomSrc(): string | null {
  try { return localStorage.getItem(CUSTOM_BG_KEY); } catch { return null; }
}

export default function LoginPage() {
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [searchParams] = useSearchParams();
  const [bg, setBg] = useState(loadInitialBg);
  const [customSrc, setCustomSrc] = useState(loadCustomSrc);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const data = await login(values);
      setAccessToken(data.access_token);
      message.success("登录成功");
      const next = searchParams.get("next");
      window.location.replace(next || "/");
    } catch (err) {
      if (axios.isAxiosError(err) && !err.response) {
        message.error("无法连接服务器，请检查网络或后端是否启动");
      } else if (axios.isAxiosError(err) && err.response?.status === 401) {
        message.error("登录失败，请检查账号密码");
      } else {
        message.error("登录失败，请稍后重试");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.wrapper} className="login-wrapper">
      {/* Left: brand panel */}
      <div style={styles.brand} className="login-brand">
        <div style={styles.brandContent}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <AppLogo size={44} id="login-brand" />
            <span style={styles.brandName}>RightOn</span>
          </div>
          <p style={styles.tagline}>
            从错题中成长
            <br />
            向正确迈进
          </p>
        </div>
        {/* decorative dots */}
        <div style={styles.dots}>
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} style={{ ...styles.dot, opacity: 0.08 + (i % 3) * 0.06 }} />
          ))}
        </div>
      </div>

      {/* Right: form panel */}
      <div
        style={{
          ...styles.formPanel,
          backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.06), rgba(0,0,0,0.10)), url('${bg.src}')`,
        }}
        className="login-form"
      >
        {/* Background picker — bottom left */}
        <div style={styles.bgPicker} className="bg-picker">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.key}
              onClick={() => {
                setBg({ key: b.key, src: b.src });
                try { localStorage.setItem("login-bg", b.key); } catch {}
              }}
              style={{
                ...styles.bgThumb,
                backgroundImage: `url('${b.src}')`,
                outline: bg.key === b.key ? "2px solid #fff" : "none",
                outlineOffset: 2,
              }}
            />
          ))}
          {/* Custom image thumbnail — always shown when a custom image exists */}
          {customSrc && (
            <button
              onClick={() => {
                setBg({ key: "custom", src: customSrc });
                try { localStorage.setItem("login-bg", "custom"); } catch {}
              }}
              style={{
                ...styles.bgThumb,
                backgroundImage: `url('${customSrc}')`,
                outline: bg.key === "custom" ? "2px solid #fff" : "none",
                outlineOffset: 2,
              }}
              title="使用自定义背景"
            />
          )}
          {/* Upload / replace button */}
          <button
            onClick={() => fileRef.current?.click()}
            style={styles.bgThumbUpload}
            title={customSrc ? "更换自定义背景" : "上传自定义背景"}
          >
            {customSrc ? (
              /* refresh icon — single circular arrow */
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="#fff" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M13.5 2v3h-3" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              /* plus icon */
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                setBg({ key: "custom", src: dataUrl });
                setCustomSrc(dataUrl);
                try {
                  localStorage.setItem("login-bg", "custom");
                  localStorage.setItem(CUSTOM_BG_KEY, dataUrl);
                } catch {}
              };
              reader.readAsDataURL(file);
              e.target.value = "";
            }}
          />
        </div>
        <div style={styles.glassCard} className="login-glass">
          <div className="form-logo-row" style={styles.formLogoRow}>
            <AppLogo size={36} id="login-form" />
            <span style={styles.formLogoText}>RightOn</span>
          </div>
          <p style={styles.formTitle}>欢迎回来</p>
          <p style={styles.formSubtitle}>登录你的账号</p>
          <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 32 }}>
            <Form.Item
              name="username"
              rules={[{ required: true, message: "请输入用户名" }]}
              style={{ marginBottom: 20 }}
            >
              <Input placeholder="用户名" style={styles.input} />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: "请输入密码" }]}
              style={{ marginBottom: 32 }}
            >
              <Input.Password placeholder="密码" style={styles.input} />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={submitting}
              style={styles.submitBtn}
            >
              登录
            </Button>
          </Form>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ── */

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: "flex",
    minHeight: "100vh",
  },

  /* ── Left brand ── */
  brand: {
    flex: "0 0 35%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
    background:
      "linear-gradient(160deg, #1a0533 0%, #2d1b69 40%, #4a2c8a 70%, #6b3fa0 100%)",
  },
  brandContent: {
    position: "relative",
    zIndex: 2,
    textAlign: "center",
  },
  brandName: {
    color: "#fff",
    fontFamily: "'Righteous', cursive",
    fontSize: 36,
    letterSpacing: 2,
    lineHeight: 1,
  },
  tagline: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 18,
    lineHeight: 1.8,
    marginTop: 28,
    fontWeight: 300,
    letterSpacing: 4,
  },
  dots: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexWrap: "wrap",
    alignContent: "center",
    justifyContent: "center",
    gap: 48,
    zIndex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#fff",
    flexShrink: 0,
  },

  /* ── Right form ── */
  formPanel: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
    background: "#1a3a2a",
    backgroundSize: "cover",
    backgroundPosition: "center",
  },
  glassCard: {
    position: "relative",
    zIndex: 2,
    width: 400,
    maxWidth: "90vw",
    padding: "44px 40px 40px",
    borderRadius: 20,
    background: "rgba(255, 255, 255, 0.65)",
    backdropFilter: "blur(40px) saturate(1.8)",
    WebkitBackdropFilter: "blur(40px) saturate(1.8)",
    boxShadow: "0 2px 20px rgba(0,0,0,0.06)",
    border: "1px solid rgba(255,255,255,0.5)",
  },
  formLogoRow: {
    display: "none",
    alignItems: "center",
    gap: 10,
    marginBottom: 24,
  },
  formLogoText: {
    fontFamily: "'Righteous', cursive",
    fontSize: 22,
    letterSpacing: 1,
    color: "#1d1d1f",
    lineHeight: 1,
  },
  formTitle: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif",
    fontSize: 28,
    fontWeight: 600,
    color: "#1d1d1f",
    lineHeight: 1.2,
    margin: 0,
    letterSpacing: -0.5,
  },
  formSubtitle: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif",
    fontSize: 15,
    color: "#86868b",
    lineHeight: 1.4,
    margin: "8px 0 0",
    fontWeight: 400,
  },
  input: {
    borderRadius: 12,
    height: 48,
    fontSize: 16,
    background: "rgba(0,0,0,0.03)",
    border: "1px solid rgba(0,0,0,0.06)",
  },
  submitBtn: {
    height: 48,
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 500,
    background: "#1d1d1f",
    border: "none",
  },
  bgPicker: {
    position: "absolute",
    bottom: 16,
    left: 16,
    zIndex: 10,
    display: "flex",
    gap: 8,
  },
  bgThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundSize: "cover",
    backgroundPosition: "center",
    border: "2px solid rgba(255,255,255,0.4)",
    cursor: "pointer",
    padding: 0,
    transition: "transform 0.15s ease, border-color 0.15s ease",
  },
  bgThumbUpload: {
    width: 36,
    height: 36,
    borderRadius: 8,
    background: "rgba(255,255,255,0.15)",
    backdropFilter: "blur(8px)",
    border: "2px dashed rgba(255,255,255,0.4)",
    cursor: "pointer",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "transform 0.15s ease, background 0.15s ease",
  },
};

/* ── Responsive + micro-interactions ── */
if (typeof window !== "undefined" && !document.getElementById("login-responsive")) {
  const style = document.createElement("style");
  style.id = "login-responsive";
  style.textContent = `
    @media (max-width: 768px) {
      .login-wrapper { flex-direction: column !important; }
      .login-brand   { display: none !important; }
      .login-form    { flex: 1 !important; }
      .login-glass   { padding: 40px 28px 32px !important; }
      .form-logo-row { display: flex !important; margin-bottom: 28px !important; justify-content: center !important; }
      .form-logo-row svg { width: 48px !important; height: 48px !important; }
      .form-logo-row span { font-size: 30px !important; }
    }
    .login-form .ant-input-password {
      background: rgba(0,0,0,0.03) !important;
      border: 1px solid rgba(0,0,0,0.06) !important;
      border-radius: 12px !important;
      box-shadow: none !important;
      transition: border-color 0.25s ease, background 0.25s ease, box-shadow 0.25s ease !important;
    }
    .login-form .ant-input-password .ant-input {
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
    }
    .login-form .ant-input-password:focus-within {
      background: rgba(0,0,0,0.01) !important;
      border-color: rgba(0,0,0,0.18) !important;
      box-shadow: 0 0 0 3px rgba(0,0,0,0.04) !important;
    }
    .login-form .ant-input {
      background: rgba(0,0,0,0.03) !important;
      border: 1px solid rgba(0,0,0,0.06) !important;
      border-radius: 12px !important;
      box-shadow: none !important;
      transition: border-color 0.25s ease, background 0.25s ease, box-shadow 0.25s ease !important;
    }
    .login-form .ant-input:focus,
    .login-form .ant-input-focused {
      background: rgba(0,0,0,0.01) !important;
      border-color: rgba(0,0,0,0.18) !important;
      box-shadow: 0 0 0 3px rgba(0,0,0,0.04) !important;
    }
    .login-form .ant-input::placeholder {
      color: #a1a1a6 !important;
    }
    .login-form .ant-btn-primary {
      background: #1d1d1f !important;
      border: none !important;
      box-shadow: none !important;
      transition: background 0.2s ease, transform 0.1s ease !important;
    }
    .login-form .ant-btn-primary:hover {
      background: #333 !important;
    }
    .login-form .ant-btn-primary:active {
      background: #111 !important;
    }
    .login-form .bg-picker button:hover {
      transform: scale(1.1) !important;
      border-color: rgba(255,255,255,0.8) !important;
    }


  `;
  document.head.appendChild(style);
}
