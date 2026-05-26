import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Inject the build's git short SHA + ISO timestamp so the About page can
// show users which deploy they're looking at. Git isn't available inside
// the frontend Docker build (only frontend/ is the context), so we fall
// back to a placeholder there — that's the right signal: local Docker dev
// shows "dev", Cloudflare deploys (run from the repo) show the real SHA.
let commit = 'dev'
try {
  commit = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  // ignore — keep 'dev'
}
const buildTime = new Date().toISOString()

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
