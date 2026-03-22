import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

export default defineConfig({
  root: __dirname,
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      '@titan-design/react-ui': path.resolve(__dirname, 'titan-shim.tsx'),
    },
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js'],
  },
  build: {
    outDir: path.resolve(__dirname, '..', '..', 'dist', 'dashboard'),
    emptyOutDir: true,
    target: 'es2020',
  },
});
