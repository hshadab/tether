import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/events': 'http://localhost:4020',
      '/demo': 'http://localhost:4020',
      '/weather': 'http://localhost:4020',
      '/.well-known': 'http://localhost:4020',
      '/a2a': 'http://localhost:4020',
      '/health': 'http://localhost:4020',
    },
  },
});
