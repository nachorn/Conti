import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../shared') },
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/admin': { target: loadEnv(mode, __dirname, 'VITE_').VITE_SOCKET_URL || 'http://localhost:3001' },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
}))
