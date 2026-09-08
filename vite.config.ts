import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', plugins: [react()], worker: {format:'es'}, optimizeDeps:{exclude:['@cornerstonejs/dicom-image-loader']}, build: {chunkSizeWarningLimit:1800} });
