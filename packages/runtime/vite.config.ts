import { defineConfig } from 'vite';

// The embeddable script: one self-contained ES module (dist/vex-avatar.js) that the studio
// server hands to host pages.
export default defineConfig({
  build: {
    lib: { entry: 'src/embed.ts', formats: ['es'], fileName: () => 'vex-avatar.js' },
    target: 'es2022',
    sourcemap: false,
  },
});
