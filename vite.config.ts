import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'

const network = process.env.NETWORK === '1'

export default defineConfig({
  plugins: [vue(), ...(network ? [basicSsl()] : [])],
  server: {
    host: network,
  },
})
