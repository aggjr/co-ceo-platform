const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const versionFile = path.join(root, 'version.json');

let version = { major: 0, minor: 0, patch: 0 };
if (fs.existsSync(versionFile)) {
  version = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
}

if (process.env.BUMP_VERSION !== '0') {
  version.patch += 1;
}

fs.writeFileSync(versionFile, `${JSON.stringify(version, null, 2)}\n`);

const semver = `${version.major}.${version.minor}.${version.patch}`;
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.version !== semver) {
  pkg.version = semver;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

const display = `V${semver}`;
const js = `export const APP_VERSION = '${display}';\n`;
const ts = `export const APP_VERSION = '${display}';\n`;

const feDir = path.join(root, 'frontend/src/generated');
const beDir = path.join(root, 'src/generated');
fs.mkdirSync(feDir, { recursive: true });
fs.mkdirSync(beDir, { recursive: true });
fs.writeFileSync(path.join(feDir, 'version.js'), js);
fs.writeFileSync(path.join(beDir, 'version.ts'), ts);

console.log(`[version] ${display}`);
