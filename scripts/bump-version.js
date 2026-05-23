const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { loadGitMachinesConfig } = require('./lib/git-machines');

const root = path.join(__dirname, '..');
const versionFile = path.join(root, 'version.json');
const packageFile = path.join(root, 'package.json');
const integrateMode = process.argv.includes('--integrate');

function parseSemver(input) {
  if (!input) return null;
  const m = String(input).trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function maxSemver(versions) {
  return versions.reduce((best, cur) => (compareSemver(cur, best) > 0 ? cur : best));
}

function readVersionJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (
      Number.isFinite(raw.major) &&
      Number.isFinite(raw.minor) &&
      Number.isFinite(raw.patch)
    ) {
      return { major: raw.major, minor: raw.minor, patch: raw.patch };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function readPackageVersion() {
  if (!fs.existsSync(packageFile)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    return parseSemver(pkg.version);
  } catch {
    return null;
  }
}

function readGitVersion(ref, fileName) {
  try {
    const raw = execSync(`git show ${ref}:${fileName}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (fileName === 'version.json') {
      const parsed = JSON.parse(raw);
      if (
        Number.isFinite(parsed.major) &&
        Number.isFinite(parsed.minor) &&
        Number.isFinite(parsed.patch)
      ) {
        return {
          major: parsed.major,
          minor: parsed.minor,
          patch: parsed.patch,
        };
      }
      return null;
    }
    if (fileName === 'package.json') {
      const pkg = JSON.parse(raw);
      return parseSemver(pkg.version);
    }
  } catch {
    /* ref ou arquivo ausente */
  }
  return null;
}

function collectIntegrateCandidates() {
  const candidates = [
    readVersionJson(versionFile),
    readPackageVersion(),
  ].filter(Boolean);

  for (const ref of ['HEAD', 'origin/main']) {
    candidates.push(readGitVersion(ref, 'version.json'));
    candidates.push(readGitVersion(ref, 'package.json'));
  }
  for (const branch of loadGitMachinesConfig().machineBranches) {
    const remote = `origin/${branch}`;
    candidates.push(readGitVersion(remote, 'version.json'));
    candidates.push(readGitVersion(remote, 'package.json'));
  }

  return candidates.filter(Boolean);
}

let version = readVersionJson(versionFile) || { major: 0, minor: 0, patch: 0 };

if (integrateMode) {
  const candidates = collectIntegrateCandidates();
  if (candidates.length > 0) {
    version = maxSemver(candidates);
  }
}

if (process.env.BUMP_VERSION !== '0') {
  version.patch += 1;
}

fs.writeFileSync(versionFile, `${JSON.stringify(version, null, 2)}\n`);

const semver = `${version.major}.${version.minor}.${version.patch}`;
const display = `V${semver}`;
const js = `export const APP_VERSION = '${display}';\n`;
const ts = `export const APP_VERSION = '${display}';\n`;

const feDir = path.join(root, 'frontend/src/generated');
const beDir = path.join(root, 'src/generated');
fs.mkdirSync(feDir, { recursive: true });
fs.mkdirSync(beDir, { recursive: true });
fs.writeFileSync(path.join(feDir, 'version.js'), js);
fs.writeFileSync(path.join(beDir, 'version.ts'), ts);

if (fs.existsSync(packageFile)) {
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  pkg.version = semver;
  fs.writeFileSync(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);
}

const mode = integrateMode ? 'integrate' : 'build';
console.log(`[version:${mode}] ${display}`);
