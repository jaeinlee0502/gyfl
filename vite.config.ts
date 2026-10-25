import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import process from 'node:process'
import vue from '@vitejs/plugin-vue'
import { validatePublicConfig } from './scripts/public-config.mjs'

export default defineConfig(({ mode }) => {
  validatePublicConfig(loadEnv(mode, process.cwd(), 'VITE_'))
  return {
    base: '/gyfl/',
    plugins: [vue()],
    test: { environment: 'jsdom' },
  }
})
