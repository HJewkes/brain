import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  external: ['better-sqlite3', 'sqlite-vec', '@huggingface/transformers'],
})
