/**
 * Sincroniza tests/catalog.json com arquivos *.test.ts existentes e contagens do Jest.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'tests', 'catalog.json');

function walkTests(dir, prefix) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = `${prefix}/${name}`.replace(/\\/g, '/');
    if (fs.statSync(full).isDirectory()) {
      out.push(...walkTests(full, rel));
    } else if (name.endsWith('.test.ts')) {
      out.push(rel);
    }
  }
  return out;
}

function countCases(filePath) {
  const content = fs.readFileSync(path.join(ROOT, filePath), 'utf8');
  const itCount = (content.match(/\bit\s*\(/g) || []).length;
  const testCount = (content.match(/\btest\s*\(/g) || []).length;
  return itCount + testCount;
}

function assignUnit(testFile) {
  if (testFile.includes('/unit/quality/')) return 'core.quality';
  if (testFile.includes('Telemetry')) return 'core.telemetry';
  if (testFile.includes('/unit/core/')) return 'core.dal';
  if (testFile.includes('/unit/auth/') || testFile.includes('/middlewares/')) return 'core.auth';
  return null;
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const allTests = [
    ...walkTests(path.join(ROOT, 'tests', 'unit'), 'tests/unit'),
    ...walkTests(path.join(ROOT, 'tests', 'middlewares'), 'tests/middlewares'),
  ];

  const byUnit = new Map(catalog.units.map((u) => [u.id, { ...u, testFiles: [] }]));

  for (const file of allTests) {
    const unitId = assignUnit(file, catalog.units);
    if (!unitId || !byUnit.has(unitId)) continue;
    byUnit.get(unitId).testFiles.push(file);
  }

  for (const unit of byUnit.values()) {
    unit.testFiles = [...new Set(unit.testFiles)].sort();
    unit.testCaseCount = unit.testFiles.reduce((sum, f) => sum + countCases(f), 0);
  }

  catalog.units = [...byUnit.values()];
  catalog.updatedAt = new Date().toISOString().slice(0, 10);
  catalog.stats = {
    totalTestFiles: allTests.length,
    totalUnits: catalog.units.length,
    unitsWithTests: catalog.units.filter((u) => u.testFiles.length > 0).length,
    unitsWithoutTests: catalog.units.filter((u) => u.testFiles.length === 0).length,
  };

  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`✅ Catálogo atualizado: ${catalog.stats.totalTestFiles} arquivos, ${catalog.stats.unitsWithTests} unidades cobertas.`);
}

main();
