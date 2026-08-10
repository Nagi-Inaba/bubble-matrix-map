import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const packageDocument = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  publicDir: false,
  define: {
    __BUBBLE_MATRIX_MAP_VERSION__: JSON.stringify(packageDocument.version),
  },
  build: {
    ssr: resolve(import.meta.dirname, 'src/cli/main.ts'),
    outDir: 'dist-cli',
    emptyOutDir: true,
    minify: false,
    target: 'node22',
    rolldownOptions: {
      // Unzipper exposes an optional S3 adapter that is outside this local-only CLI boundary.
      // Keeping the SDK external preserves local XLSX support without adding a network dependency.
      external: ['@aws-sdk/client-s3'],
      output: {
        entryFileNames: 'bubble-matrix-map.mjs',
        codeSplitting: false,
      },
    },
  },
  ssr: {
    noExternal: true,
  },
})
