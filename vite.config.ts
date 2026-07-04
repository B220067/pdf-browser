import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves project sites (not user/org root pages) under
// /<repo-name>/, so production asset URLs need that prefix. Dev/preview stay
// at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/pdf-browser/' : '/',
  plugins: [react(), tailwindcss()],
}))
