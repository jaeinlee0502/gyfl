import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Keep PDF decoders, CMaps and fallback fonts on the same host as the app.
// Their stable filenames are required by the PDF worker's resource requests.
export function pdfAssets() {
  const assets = new Map()
  for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
    const root = new URL(`../node_modules/pdfjs-dist/${folder}/`, import.meta.url)
    for (const name of readdirSync(root)) {
      if (name.startsWith('quickjs')) continue
      assets.set(`pdfjs/${folder}/${name}`, fileURLToPath(new URL(name, root)))
    }
  }
  return {
    name: 'local-pdf-resources',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0]
        const key = pathname.startsWith(server.config.base) ? pathname.slice(server.config.base.length) : ''
        const file = assets.get(key)
        if (!file) return next()
        res.setHeader('Content-Type', key.endsWith('.wasm') ? 'application/wasm' : key.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        res.end(readFileSync(file))
      })
    },
    generateBundle() {
      for (const [fileName, path] of assets) this.emitFile({ type: 'asset', fileName, source: readFileSync(path) })
    },
  }
}
