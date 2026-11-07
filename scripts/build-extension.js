// scripts/build-extension.js
// Capdio Extension Multi-Entry Bundler using esbuild

import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const srcDir = path.join(rootDir, 'apps', 'extension', 'src');
const publicDir = path.join(rootDir, 'apps', 'extension', 'public');
const distDir = path.join(rootDir, 'apps', 'extension', 'dist');

async function build() {
  console.log('⚡ Building Capdio MV3 Extension with esbuild...');
  const startTime = Date.now();

  // 1. Clean dist directory
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  // 2. Compile TypeScript entry points
  await esbuild.build({
    entryPoints: {
      background: path.join(srcDir, 'background', 'index.ts'),
      offscreen: path.join(srcDir, 'offscreen', 'index.ts'),
      popup: path.join(srcDir, 'popup', 'index.ts')
    },
    outdir: distDir,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
    minify: false,
    logLevel: 'info'
  });

  // 3. Copy static HTML and Manifest files
  fs.copyFileSync(
    path.join(publicDir, 'manifest.json'),
    path.join(distDir, 'manifest.json')
  );

  fs.copyFileSync(
    path.join(srcDir, 'offscreen', 'index.html'),
    path.join(distDir, 'offscreen.html')
  );

  fs.copyFileSync(
    path.join(srcDir, 'popup', 'index.html'),
    path.join(distDir, 'popup.html')
  );

  const duration = Date.now() - startTime;
  console.log(`✅ Build completed in ${duration}ms -> ${distDir}`);
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
