import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// build: 1773544198
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-1773544198.js`,
        chunkFileNames: `assets/[name]-1773544198.js`,
        assetFileNames: `assets/[name]-1773544198.[ext]`
      }
    }
  }
})
