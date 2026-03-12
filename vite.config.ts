import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [vue(), basicSsl()],
  server: {
    host: true,
    proxy: {
      '/handy-api': {
        target: 'https://www.handyfeeling.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/handy-api/, '/api/handy-rest/v3'),
      },
    },
  },
})
