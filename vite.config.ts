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


function getShortCommit(): string {
  if (process.env.GIT_COMMIT_SHORT) {
    return process.env.GIT_COMMIT_SHORT;
  }

  try {
    return execSync('git rev-parse --short HEAD 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function getVersionLabel(): string {
  return getReleaseVersion();
}


function getBuildStamp(): string {
  const iso = getBuildDate();
  return iso.replace(/[-:TZ.]/g, '').slice(0, 12);
}


function formatDateStamp(date: string): string {
  return date.slice(0, 10).replace(/-/g, '.');
}

function getReleaseVersion(): string {
  if (process.env.VERSION) {
    return process.env.VERSION;
  }
  const buildDate = getBuildDate();
  const datePart = formatDateStamp(buildDate);
  const shortCommit = getShortCommit();
  return shortCommit ? `v${datePart}+${shortCommit}` : `v${datePart}`;
}

function getBuildDate(): string {
  if (process.env.BUILD_DATE) {
    return process.env.BUILD_DATE;
  }
  return new Date().toISOString();
}


function writeBuildInfoPlugin() {
  return {
    name: 'write-build-info',
    closeBundle() {
      const version = getVersionLabel();
      const buildDate = getBuildDate();
      const buildStamp = getBuildStamp();
      const outDir = `dist-${version.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\./g, '-')}-${buildStamp}`;
      const payload = {
        name: 'cli-proxy-webui-react',
        version,
        buildDate,
        buildStamp,
        commit: getShortCommit() || null
      };
      const releaseNotes = [
        '# Release Notes',
        '',
        `- Name: ${payload.name}`,
        `- Version: ${payload.version}`,
        `- Build Date: ${payload.buildDate}`,
        `- Build Stamp: ${payload.buildStamp}`,
        `- Commit: ${payload.commit || 'unknown'}`,
        '',
        '## Included metadata',
        '- Login page version/build date',
        '- System page version/build date',
        '- Header UI version badge',
        '- Global footer build metadata',
        '- BUILD_INFO.json embedded in release bundle'
      ].join('\n') + '\n';
      fs.writeFileSync(path.resolve(__dirname, outDir, 'BUILD_INFO.json'), JSON.stringify(payload, null, 2) + '\n');
      fs.writeFileSync(path.resolve(__dirname, outDir, 'RELEASE.md'), releaseNotes);
      fs.writeFileSync(path.resolve(__dirname, 'RELEASE.md'), releaseNotes);
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    writeBuildInfoPlugin(),
    viteSingleFile({
      removeViteModuleLoader: true
    })
  ],
  define: {
    __APP_VERSION__: JSON.stringify(getVersionLabel()),
    __APP_BUILD_DATE__: JSON.stringify(getBuildDate()),
    __APP_BUILD_STAMP__: JSON.stringify(getBuildStamp())
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
    outDir: `dist-${getVersionLabel().replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\./g, '-')}-${getBuildStamp()}`,
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined
      }
    }
  }
});
