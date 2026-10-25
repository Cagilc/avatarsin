import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The studio talks to its server through this proxy, so in development the API is same-origin.
// STUDIO_API points it at another server (the end-to-end tests use their own).
const api = process.env['STUDIO_API'] ?? 'http://127.0.0.1:8788';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': api,
      '/v1': api,
    },
  },
});
