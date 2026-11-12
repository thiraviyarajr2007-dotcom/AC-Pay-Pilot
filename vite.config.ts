import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 600,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'vendor-react',
                priority: 50,
                test: /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
              },
              {
                name: 'vendor-firebase-firestore',
                priority: 40,
                test: /[\\/]node_modules[\\/](@firebase[\\/]firestore|firebase[\\/]firestore)/,
              },
              {
                name: 'vendor-firebase-core',
                priority: 35,
                test: /[\\/]node_modules[\\/](firebase|@firebase)[\\/]/,
              },
              {
                name: 'vendor-three',
                priority: 30,
                test: /[\\/]node_modules[\\/]three[\\/]/,
              },
              {
                name: 'vendor-recharts',
                priority: 30,
                test: /[\\/]node_modules[\\/](recharts|d3)/,
              },
              {
                name: 'vendor-ag-charts',
                priority: 20,
                test: /[\\/]node_modules[\\/]ag-charts-/,
              },
              {
                name: 'vendor-ag-grid',
                priority: 20,
                test: /[\\/]node_modules[\\/]ag-grid-/,
              },
              {
                name: 'vendor-ag-studio',
                priority: 10,
                test: /[\\/]node_modules[\\/](ag-studio|ag-stack)/,
              },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
