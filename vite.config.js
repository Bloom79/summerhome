import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from https://<user>.github.io/summerhome/ on GitHub Pages,
// so assets must be referenced under the /summerhome/ base path.
export default defineConfig({
  plugins: [react()],
  base: '/summerhome/',
})
