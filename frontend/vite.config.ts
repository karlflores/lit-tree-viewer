import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
    watch: {
      // inotify doesn't fire for files on Windows filesystem mounts in WSL.
      // Fall back to polling so Vite picks up changes correctly.
      usePolling: true,
      interval: 100,
    },
  },
})
