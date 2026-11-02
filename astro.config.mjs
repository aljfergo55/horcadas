import { defineConfig } from 'astro/config';

// Cuando tengas dominio, añade: site: 'https://tu-dominio.es'
export default defineConfig({
  vite: {
    build: {
      // Three.js es grande; el aviso por defecto (500 kB) es ruido aquí.
      chunkSizeWarningLimit: 1000,
    },
  },
});
