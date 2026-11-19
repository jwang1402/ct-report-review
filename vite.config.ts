import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {viteCommonjs} from '@originjs/vite-plugin-commonjs';
export default defineConfig({
  base: './',
  // The old public directory holds named case catalogs. Blind cases are served by the Worker.
  publicDir: false,
  plugins: [react(), viteCommonjs()],
  resolve: { alias: { events: 'events/' } },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@cornerstonejs/dicom-image-loader'], include: ['dicom-parser', 'events'] },
  build: { chunkSizeWarningLimit: 1800 },
});
