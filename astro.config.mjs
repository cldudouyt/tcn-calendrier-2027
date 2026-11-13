import { defineConfig } from 'astro/config';

// Site statique : les pages sont générées depuis data.json au moment du build.
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
