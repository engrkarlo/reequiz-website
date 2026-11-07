import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Include dynamically imported local PDF/OCR modules and PDF worker in
  // the manifest so the service worker can precache them on first install.
  build: { manifest: 'offline-manifest.json' }
});
