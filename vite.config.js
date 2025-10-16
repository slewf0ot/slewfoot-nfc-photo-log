// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // If deploying to GitHub Pages under a repo, set base:
  base: '/slewfoot-nfc-photo-log/', // <-- change if your repo name is different
})

