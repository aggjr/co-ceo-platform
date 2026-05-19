/**
 * Calcula arquivos de teste mínimos a partir do git diff + tests/impact-map.json
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

function loadImpactMap() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'impact-map.json'), 'utf8'));
}

function gitChangedFiles() {
  try {
    const out = execSync('git diff --name-only HEAD', { cwd: ROOT, encoding: 'utf8' });
    const staged = execSync('git diff --name-only --cached', { cwd: ROOT, encoding: 'utf8' });
    const untracked = execSync('git ls-files --others --exclude-standard', {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return [...new Set([out, staged, untracked].join('\n').split('\n').filter(Boolean))];
  } catch {
    return [];
  }
}

function matchGlob(file, pattern) {
  const normalized = file.replace(/\\/g, '/');
  const glob = pattern.replace(/\\/g, '/');
  if (glob.endsWith('/**')) {
    const prefix = glob.slice(0, -3);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  const re = new RegExp(`^${glob.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`);
  return re.test(normalized);
}

function expandPatterns(patterns) {
  const files = new Set();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.test.ts')) files.add(path.relative(ROOT, full).replace(/\\/g, '/'));
    }
  };
  for (const pattern of patterns) {
    if (pattern.endsWith('**')) {
      const base = pattern.replace(/\*\*$/, '').replace(/\/$/, '');
      walk(path.join(ROOT, base));
    } else {
      const full = path.join(ROOT, pattern);
      if (fs.existsSync(full)) files.add(pattern.replace(/\\/g, '/'));
    }
  }
  return [...files];
}

function main() {
  const map = loadImpactMap();
  const changed = gitChangedFiles();
  const requiresFull = changed.some((f) =>
    (map.fullRetestTriggers || []).some((t) => matchGlob(f, t))
  );

  const patterns = new Set();
  const matchedRules = [];

  if (!requiresFull) {
    for (const file of changed) {
      for (const [glob, rule] of Object.entries(map.paths || {})) {
        if (matchGlob(file, glob)) {
          matchedRules.push(glob);
          for (const p of rule.testPatterns || []) patterns.add(p);
        }
      }
    }
  }

  const allTests = expandPatterns(['tests/unit/**', 'tests/middlewares/**']);
  let testFiles;
  if (requiresFull || !patterns.size) {
    testFiles = allTests;
  } else {
    testFiles = expandPatterns([...patterns]);
  }

  const result = {
    mode: requiresFull ? 'full' : patterns.size ? 'impact' : 'full',
    changedFiles: changed,
    matchedRules: [...new Set(matchedRules)],
    testFiles: [...new Set(testFiles)].sort(),
    skippedCount: requiresFull ? 0 : Math.max(0, allTests.length - testFiles.length),
  };

  const outPath = path.join(ROOT, 'reports', 'impact-plan.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main();
