/**
 * Metas de teste proporcionais ao tamanho do código e às funcionalidades mapeadas.
 * Não descarta casos: eleva o piso quando o módulo cresce.
 */
const fs = require('fs');
const path = require('path');

function matchGlob(filePath, pattern) {
  const normalized = filePath.replace(/\\/g, '/');
  const glob = pattern.replace(/\\/g, '/');

  if (glob.endsWith('/**')) {
    const prefix = glob.slice(0, -3);
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }

  const re = new RegExp(
    `^${glob.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`
  );
  return re.test(normalized);
}

function walkSourceFiles(dir, prefix, out) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = `${prefix}/${name}`.replace(/\\/g, '/');
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walkSourceFiles(full, rel, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(rel);
    }
  }
}

function countSourceFilesForUnit(rootDir, sourcePaths) {
  if (!sourcePaths?.length) return { files: 0, lines: 0 };

  const all = [];
  walkSourceFiles(path.join(rootDir, 'src'), 'src', all);

  const matched = all.filter((rel) =>
    sourcePaths.some((g) => matchGlob(rel, g))
  );

  let lines = 0;
  for (const rel of matched) {
    const content = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    lines += content.split('\n').length;
  }

  return { files: matched.length, lines };
}

/**
 * @param {object} unit - entrada do catalog.json
 * @param {object} policyEntry - tests/coverage-policy.json units[id]
 * @param {string} rootDir
 */
function resolveProportionalTargets(unit, policyEntry, rootDir) {
  const targets = { ...(policyEntry?.targets || {}) };
  if (!targets.proportional) {
    return {
      targets,
      proportionality: null,
    };
  }

  const { files, lines } = countSourceFilesForUnit(rootDir, unit.sourcePaths || []);
  const funcCount = (policyEntry?.functionalities || []).length;

  const floorCases = targets.minTestCasesFloor ?? targets.minTestCases ?? 5;
  const floorFiles = targets.minTestFilesFloor ?? targets.minTestFiles ?? 1;
  const perFile = targets.testCasesPerSourceFile ?? 1.5;
  const perFunc = targets.testCasesPerFunctionality ?? 2;
  const per1kLines = targets.testCasesPer1000Lines ?? 3;

  const fromFiles = Math.ceil(files * perFile);
  const fromFuncs = funcCount * perFunc;
  const fromLines = Math.ceil((lines / 1000) * per1kLines);

  const minTestCases = Math.max(floorCases, fromFiles + fromFuncs + fromLines);
  const minTestFiles = Math.max(
    floorFiles,
    Math.ceil(files * (targets.testFilesPerSourceFile ?? 0.2))
  );

  return {
    targets: {
      ...targets,
      minTestCases,
      minTestFiles,
    },
    proportionality: {
      sourceFiles: files,
      sourceLines: lines,
      functionalities: funcCount,
      computedMinTestCases: minTestCases,
      computedMinTestFiles: minTestFiles,
    },
  };
}

module.exports = {
  matchGlob,
  countSourceFilesForUnit,
  resolveProportionalTargets,
};
