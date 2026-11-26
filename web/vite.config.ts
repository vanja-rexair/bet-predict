import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './', // radi i sa poddomena (GitHub Pages) i iz Android paketa
  plugins: [react()],
  server: { proxy: { '/data': 'http://localhost:8787', '/api': 'http://localhost:8787' } },
});
