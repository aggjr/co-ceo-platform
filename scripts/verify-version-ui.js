/**
 * Garante que login e sidebar usam o pipeline de versao (nao V0.0.x hardcoded).
 * Rodado automaticamente por bump-version.js e npm run verify:version-ui.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(__dirname, 'version-ui-surfaces.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const HARDCODED = /V\d+\.\d+\.\d+/g;

function fail(msg) {
  throw new Error(msg);
}

function read(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) fail(`Arquivo ausente: ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

function scanHardcoded(dirRel) {
  const dir = path.join(root, dirRel);
  if (!fs.existsSync(dir)) return;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'generated' || ent.name === 'node_modules') continue;
        stack.push(abs);
        continue;
      }
      if (!/\.(js|ts|tsx|jsx|html)$/.test(ent.name)) continue;
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (rel.includes('/generated/')) continue;
      const text = fs.readFileSync(abs, 'utf8');
      const hits = text.match(HARDCODED);
      if (hits?.length) {
        fail(`Versao hardcoded em ${rel}: ${[...new Set(hits)].join(', ')}`);
      }
    }
  }
}

scanHardcoded('frontend/src');

function verifyVersionUi() {
  for (const rel of manifest.generatedFiles) {
    const text = read(rel);
    if (!text.includes('APP_VERSION')) fail(`${rel} sem APP_VERSION`);
  }

  for (const surface of manifest.uiSurfaces) {
    const text = read(surface.file);
    for (const marker of surface.markers) {
      if (!text.includes(marker)) {
        fail(`${surface.id}: ${surface.file} deve referenciar "${marker}"`);
      }
    }
  }

  scanHardcoded('frontend/src');
}

if (require.main === module) {
  try {
    verifyVersionUi();
    console.log('[verify:version-ui] OK — login, sidebar e superficies sem Vx.y.z fixo.');
  } catch (e) {
    console.error(`[verify:version-ui] ${e.message}`);
    process.exit(1);
  }
}

module.exports = { verifyVersionUi };
