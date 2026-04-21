import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import { execSync } from 'child_process';
import fs from 'fs';

// Get version from environment, git tag, or package.json
function getVersion(): string {
  // 1. Environment variable (set by GitHub Actions)
  if (process.env.VERSION) {
    return process.env.VERSION;
  }

  // 2. Try git tag
  try {
    const gitTag = execSync('git describe --tags --exact-match 2>/dev/null || git describe --tags 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
    if (gitTag) {
      return gitTag;
    }
  } catch {
    // Git not available or no tags
  }

  // 3. Fall back to package.json version
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));
    if (pkg.version && pkg.version !== '0.0.0') {
      return pkg.version;
    }
  } catch {
    // package.json not readable
  }

  return 'dev';
}

function resolveManualChunk(id: string) {
  if (!id.includes('node_modules')) {
    return undefined;
  }

  if (
    id.includes('react-chartjs-2') ||
    id.includes('chart.js')
  ) {
    return 'charts';
  }

  if (
    id.includes('@uiw/react-codemirror') ||
    id.includes('@codemirror/')
  ) {
    return 'editor';
  }

  if (
    id.includes('react-router-dom') ||
    id.includes('react-dom') ||
    id.includes('react/') ||
    id.includes('/react') ||
    id.includes('i18next') ||
    id.includes('react-i18next') ||
    id.includes('zustand')
  ) {
    return 'framework';
  }

  return 'vendor';
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const singleFileBuild = mode === 'singlefile' || process.env.SINGLE_FILE === 'true';

  return {
    plugins: [
      react(),
      ...(singleFileBuild
        ? [
            viteSingleFile({
              removeViteModuleLoader: true
            }),
          ]
        : []),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(getVersion())
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    css: {
      modules: {
        localsConvention: 'camelCase',
        generateScopedName: '[name]__[local]___[hash:base64:5]'
      },
      preprocessorOptions: {
        scss: {
          additionalData: `@use "@/styles/variables.scss" as *;`
        }
      }
    },
    build: {
      target: 'es2020',
      outDir: 'dist',
      cssCodeSplit: !singleFileBuild,
      ...(singleFileBuild
        ? {
            assetsInlineLimit: 100000000,
            chunkSizeWarningLimit: 100000000,
          }
        : {
            chunkSizeWarningLimit: 900,
          }),
      rollupOptions: {
        output: singleFileBuild
          ? {
              inlineDynamicImports: true,
              manualChunks: undefined
            }
          : {
              manualChunks: resolveManualChunk
            }
      }
    }
  };
});
