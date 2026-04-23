import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';
import { execSync } from 'child_process';
import fs from 'fs';

const DEV_PROXY_PREFIX = '/__dev_proxy__';
const SKIP_REQUEST_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'host',
  'origin',
  'referer',
]);
const SKIP_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

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

function createDevManagementProxy(): Plugin {
  return {
    name: 'dev-management-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl =
          (req as typeof req & { originalUrl?: string }).originalUrl || req.url || '';
        if (!requestUrl.startsWith(`${DEV_PROXY_PREFIX}/`)) {
          next();
          return;
        }

        const suffix = requestUrl.slice(DEV_PROXY_PREFIX.length + 1);
        const slashIndex = suffix.indexOf('/');
        if (slashIndex <= 0) {
          res.statusCode = 400;
          res.end('Missing proxy target');
          return;
        }

        try {
          const targetBase = decodeURIComponent(suffix.slice(0, slashIndex));
          const targetPath = suffix.slice(slashIndex);
          const targetUrl = new URL(`${targetBase.replace(/\/+$/g, '')}${targetPath}`);

          const headers: Record<string, string> = {};
          Object.entries(req.headers).forEach(([key, value]) => {
            const lowerKey = key.toLowerCase();
            if (SKIP_REQUEST_HEADERS.has(lowerKey) || lowerKey.startsWith('sec-')) {
              return;
            }
            if (Array.isArray(value)) {
              headers[key] = value.join(', ');
            } else if (typeof value === 'string') {
              headers[key] = value;
            }
          });

          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

          const upstream = await fetch(targetUrl, {
            method: req.method || 'GET',
            headers,
            body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
            redirect: 'manual',
          });

          const responseBody = Buffer.from(await upstream.arrayBuffer());
          res.statusCode = upstream.status;
          res.statusMessage = upstream.statusText;

          upstream.headers.forEach((value, key) => {
            if (SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
              return;
            }
            res.setHeader(key, value);
          });
          res.setHeader('content-length', String(responseBody.length));
          res.end(responseBody);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Proxy request failed';
          server.config.logger.error(`[dev-management-proxy] ${message}`);
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const singleFileBuild = mode === 'singlefile' || process.env.SINGLE_FILE === 'true';

  return {
    plugins: [
      createDevManagementProxy(),
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
