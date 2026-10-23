import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'

// Обычная сборка кладётся в wwwroot бэкенда — exe раздаёт её сам.
// Демо (vite build --mode mock) — один HTML-файл на моках, без сервера.
export default defineConfig(({ mode }) => {
  const mock = mode === 'mock'
  return {
    plugins: mock ? [react(), viteSingleFile()] : [react()],
    resolve: mock ? {} : {
      alias: [{ find: /^\.\/mock\/api$/, replacement: fileURLToPath(new URL('./src/mock/stub.ts', import.meta.url)) }],
    },
    build: mock
      ? { outDir: 'dist-mock', emptyOutDir: true, assetsInlineLimit: 100_000_000 }
      : { outDir: '../server/wwwroot', emptyOutDir: true },
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:5080',
        '/hubs': { target: 'http://localhost:5080', ws: true },
      },
    },
  }
})
