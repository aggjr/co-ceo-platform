/**
 * Lista arquivos alterados na branch atual E na branch par (outra máquina)
 * desde o ancestral comum com a branch de integração.
 *
 * Uso (antes do commit):
 *   npm run check:branch-overlap
 *   npx ts-node scripts/check-branch-overlap.ts --peer=origin/feat/machine-agent
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const LOCAL_ENV = path.join(__dirname, 'branch-peer.local.env');

function loadLocalEnv(): void {
  if (!fs.existsSync(LOCAL_ENV)) return;
  const text = fs.readFileSync(LOCAL_ENV, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    const val = t.slice(i + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : undefined;
}

function git(cmd: string): string {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function refExists(ref: string): boolean {
  try {
    git(`git rev-parse --verify "${ref}"`);
    return true;
  } catch {
    return false;
  }
}

function changedFilesSince(base: string, head: string): Set<string> {
  const out = git(`git diff --name-only "${base}...${head}"`);
  if (!out) return new Set();
  return new Set(
    out
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
  );
}

function main(): void {
  loadLocalEnv();

  const integration =
    arg('integration') ||
    process.env.INTEGRATION_BRANCH ||
    'main';
  const peer = arg('peer') || process.env.PEER_BRANCH || 'origin/note-guto';
  const current = 'HEAD';
  const integrationRef = refExists(`origin/${integration}`)
    ? `origin/${integration}`
    : integration;

  try {
    git('git fetch origin --quiet');
  } catch {
    // offline ou sem remote — segue com refs locais
  }

  if (!refExists(peer)) {
    console.log(`Branch par não encontrada: ${peer}`);
    console.log('Crie a branch na outra máquina ou ajuste PEER_BRANCH em scripts/branch-peer.local.env');
    process.exit(0);
  }
  if (!refExists(integrationRef)) {
    console.error(`Branch de integração não encontrada: ${integrationRef}`);
    process.exit(1);
  }

  const baseCurrent = git(`git merge-base "${integrationRef}" "${current}"`);
  const basePeer = git(`git merge-base "${integrationRef}" "${peer}"`);

  const mine = changedFilesSince(baseCurrent, current);
  const theirs = changedFilesSince(basePeer, peer);
  const overlap = [...mine].filter((f) => theirs.has(f)).sort();

  const branchName = git('git rev-parse --abbrev-ref HEAD');

  console.log('--- check-branch-overlap ---');
  console.log(`Integração: ${integrationRef}`);
  console.log(`Branch atual: ${branchName}`);
  console.log(`Branch par:   ${peer}`);
  console.log(`Arquivos só na atual: ${mine.size}`);
  console.log(`Arquivos só na par:    ${theirs.size}`);
  console.log(`Sobreposição:          ${overlap.length}`);

  if (overlap.length === 0) {
    console.log('\nOK — nenhum arquivo em comum com a outra máquina neste intervalo.');
    process.exit(0);
  }

  console.log('\nArquivos que AMBAS as branches alteraram (revisar antes do merge):');
  for (const f of overlap) {
    console.log(`  ${f}`);
  }
  console.log(
    '\nSugestão: git diff ' +
      `${integrationRef}...HEAD -- <arquivo>` +
      ' e ' +
      `git diff ${integrationRef}...${peer} -- <arquivo>`
  );
  process.exit(2);
}

main();
