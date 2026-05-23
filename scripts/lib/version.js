const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

function formatVersion(v) {
  return `V${v.major}.${v.minor}.${v.patch}`;
}

function readVersionJsonFile(filePath) {
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

function readVersionFromGitRef(cwd, ref, fileName = 'version.json') {
  try {
    const raw = execSync(`git show ${ref}:${fileName}`, {
      cwd,
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
    }
    if (fileName === 'package.json') {
      return parseSemver(JSON.parse(raw).version);
    }
  } catch {
    /* ref ausente */
  }
  return null;
}

module.exports = {
  parseSemver,
  compareSemver,
  formatVersion,
  readVersionJsonFile,
  readVersionFromGitRef,
};
