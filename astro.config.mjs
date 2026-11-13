import { defineConfig } from 'astro/config';

// Site statique : les pages sont générées depuis data.json au moment du build.
export default defineConfig({
  // URL publique : sert aux liens absolus (flux RSS, partage).
  site: 'https://tcn-calendrier-2027.cldudouyt.workers.dev',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
