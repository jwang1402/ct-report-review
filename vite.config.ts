import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {viteCommonjs} from '@originjs/vite-plugin-commonjs';
export default defineConfig({ base: './', plugins: [react(),viteCommonjs()], resolve:{alias:{events:'events/'}}, worker: {format:'es'}, optimizeDeps:{exclude:['@cornerstonejs/dicom-image-loader'],include:['dicom-parser','events']}, build: {chunkSizeWarningLimit:1800} });
