/**
 * Garante que o passo de integrate incrementou e propagou a versao do sistema.
 * Uso (apos bump-version.js --integrate, na branch de integracao):
 *   node scripts/verify-integrate-version.js --previous-patch=113
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

function readText(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function parsePreviousPatch() {
  const arg = process.argv.find((a) => a.startsWith('--previous-patch='));
  if (!arg) return null;
  const n = Number(arg.split('=')[1]);
  return Number.isFinite(n) ? n : null;
}

function main() {
  const version = readJson('version.json');
  const pkg = readJson('package.json');
  const semver = `${version.major}.${version.minor}.${version.patch}`;
  const display = `V${semver}`;

  if (pkg.version !== semver) {
    console.error(
      `[verify:integrate-version] package.json (${pkg.version}) != version.json (${semver})`
    );
    process.exit(1);
  }

  const feJs = readText('frontend/src/generated/version.js');
  const beTs = readText('src/generated/version.ts');
  if (!feJs.includes(`'${display}'`) && !feJs.includes(`"${display}"`)) {
    console.error('[verify:integrate-version] frontend/src/generated/version.js desalinhado');
    process.exit(1);
  }
  if (!beTs.includes(`'${display}'`) && !beTs.includes(`"${display}"`)) {
    console.error('[verify:integrate-version] src/generated/version.ts desalinhado');
    process.exit(1);
  }

  const prevPatch = parsePreviousPatch();
  if (prevPatch !== null && version.patch <= prevPatch) {
    console.error(
      `[verify:integrate-version] patch nao incrementou (antes ${prevPatch}, agora ${version.patch})`
    );
    process.exit(1);
  }

  const previewHtml = path.join(root, 'src/frontend/login_preview.html');
  if (fs.existsSync(previewHtml)) {
    const html = readText('src/frontend/login_preview.html');
    if (!html.includes(display)) {
      console.error('[verify:integrate-version] login_preview.html sem', display);
      process.exit(1);
    }
  }

  console.log(`[verify:integrate-version] OK — ${display}`);
}

main();
