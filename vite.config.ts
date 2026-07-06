import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served from the custom domain root (inkspdf.com), so assets are at "/".
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
})
