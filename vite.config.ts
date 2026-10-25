import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import process from 'node:process'
import vue from '@vitejs/plugin-vue'
import { validatePublicConfig } from './scripts/public-config.mjs'
import publicProject from './config/public-project.json'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const url = env.VITE_SUPABASE_URL?.trim() || publicProject.url
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
    || (url === publicProject.url ? publicProject.publishableKey : '')
  // Tests use isolated mocks; never contact the deployed account service.
  const accountConfig = mode === 'test' || !publicProject.ready ? {} : {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_PUBLISHABLE_KEY: key,
  }
  validatePublicConfig(accountConfig)
  return {
    base: '/gyfl/',
    plugins: [vue()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(accountConfig.VITE_SUPABASE_URL || ''),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(accountConfig.VITE_SUPABASE_PUBLISHABLE_KEY || ''),
    },
    test: { environment: 'jsdom' },
  }
})
