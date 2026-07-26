import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    allowedHosts: ['wrong.eduglow.top', '.eduglow.top'],
  },
  preview: {
    host: true,
    port: 5174,
    allowedHosts: ['wrong.eduglow.top', '.eduglow.top'],
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
