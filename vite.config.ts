import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  base: '/gyfl/',
  plugins: [vue()],
  test: { environment: 'jsdom' },
})
