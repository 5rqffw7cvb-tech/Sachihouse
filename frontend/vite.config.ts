import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss()],
      build: {
        target: 'esnext',
        // Remove license header comments (saves ~16 KiB on vendor-misc) and drop debug code
        rollupOptions: {
          treeshake: {
            moduleSideEffects: false,
          },
          output: {
            manualChunks(id) {
              if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
                return 'vendor-react';
              }
              if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run/')) {
                return 'vendor-router';
              }
              // Keep markdown-related libs in their own chunk so they stay lazy with BlogPostPage
              if (
                id.includes('node_modules/react-markdown') ||
                id.includes('node_modules/remark') ||
                id.includes('node_modules/rehype') ||
                id.includes('node_modules/unified') ||
                id.includes('node_modules/hast') ||
                id.includes('node_modules/mdast') ||
                id.includes('node_modules/micromark') ||
                id.includes('node_modules/vfile') ||
                id.includes('node_modules/devlop') ||
                id.includes('node_modules/property-information') ||
                id.includes('node_modules/decode-named-character-reference') ||
                id.includes('node_modules/html-void-elements') ||
                id.includes('node_modules/zwitch') ||
                id.includes('node_modules/ccount') ||
                id.includes('node_modules/trim-lines')
              ) {
                return 'vendor-markdown';
              }
              if (id.includes('node_modules/')) {
                return 'vendor-misc';
              }
            },
          },
        },
      },
      // Remove /*! license */ comments and drop debugger statements for smaller output
      esbuild: {
        legalComments: 'none',
        drop: ['debugger'],
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
