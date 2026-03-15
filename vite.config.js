import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// build: 1773545422
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-1773545422.js`,
        chunkFileNames: `assets/[name]-1773545422.js`,
        assetFileNames: `assets/[name]-1773545422.[ext]`
      }
    }
  }
})
