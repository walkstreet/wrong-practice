import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 识别接口前端/视觉模型都是 300s；代理略长一点，避免网关先 504。
const API_PROXY_TIMEOUT_MS = 330_000;

const backendProxy = {
  '/api': {
    target: 'http://127.0.0.1:3001',
    changeOrigin: true,
    timeout: API_PROXY_TIMEOUT_MS,
    proxyTimeout: API_PROXY_TIMEOUT_MS,
  },
  '/uploads': {
    target: 'http://127.0.0.1:3001',
    changeOrigin: true,
    timeout: API_PROXY_TIMEOUT_MS,
    proxyTimeout: API_PROXY_TIMEOUT_MS,
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    allowedHosts: ['wrong.eduglow.top'],
    // 浏览器请求同源 /api、/uploads，由 Vite 转到本机后端（避免跨域打 :3001）
    proxy: backendProxy,
  },
  preview: {
    host: true,
    port: 5174,
    allowedHosts: ['43.130.58.53', 'wrong.eduglow.top'],
    proxy: backendProxy,
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/node_modules/@ant-design/icons/'))
            return 'antd-icons';
          if (id.includes('/node_modules/rc-')) return 'antd-rc';
          if (id.includes('/node_modules/antd/')) return 'antd-vendor';
          if (
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/react-router-dom/')
          ) {
            return 'react-vendor';
          }
          return 'vendor';
        },
      },
    },
  },
});
