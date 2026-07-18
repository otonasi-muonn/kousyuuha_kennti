import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  base: './', // Generates relative asset paths, required for GitHub Pages subdirectory hosting
  plugins: [
    basicSsl()
  ],
  server: {
    host: true,
    port: 5173
  }
});
