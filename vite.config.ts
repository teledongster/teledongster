import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'

const useHttps = process.env.HTTPS === '1'

export default defineConfig({
  plugins: [vue(), ...(useHttps ? [basicSsl()] : [])],
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
