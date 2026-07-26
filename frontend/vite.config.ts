import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    allowedHosts: ['wrong.eduglow.top'],
    proxy: {
      // 浏览器请求同源 /api、/uploads，由 Vite 转到本机后端（避免跨域打 :3001）
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 5174,
    allowedHosts: ['43.130.58.53', 'wrong.eduglow.top'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
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
