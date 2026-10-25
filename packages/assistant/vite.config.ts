import { defineConfig } from 'vite';

// The embeddable script: one self-contained ES module (dist/vex-assistant.js) that Vex Core hands
// to host pages. It registers <vex-assistant> and the studio's <vex-avatar>.
export default defineConfig({
  build: {
    lib: { entry: 'src/embed.ts', formats: ['es'], fileName: () => 'vex-assistant.js' },
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
  },
});
