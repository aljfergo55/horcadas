import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://horcadas.es',
  vite: {
    build: {
      // Three.js es grande; el aviso por defecto (500 kB) es ruido aquí.
      chunkSizeWarningLimit: 1000,
    },
  },
});
