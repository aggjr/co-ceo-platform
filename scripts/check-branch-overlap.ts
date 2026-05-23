/**
 * Lista arquivos alterados na branch atual E nas outras branches de máquina
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
const MACHINES_CONFIG = path.join(__dirname, 'git-machines.json');

type MachinesConfig = {
  integrationBranch: string;
  machineBranches: string[];
};

function loadMachinesConfig(): MachinesConfig {
  const cfg = JSON.parse(fs.readFileSync(MACHINES_CONFIG, 'utf8')) as MachinesConfig;
  return {
    integrationBranch: String(cfg.integrationBranch || 'main').trim(),
    machineBranches: (cfg.machineBranches || []).map((b) => String(b).trim()).filter(Boolean),
  };
}

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

function resolvePeerRefs(branchName: string): string[] {
  const { machineBranches } = loadMachinesConfig();
  const fromConfig = machineBranches
    .filter((b) => b !== branchName)
    .map((b) => `origin/${b}`);

  const extra = (process.env.PEER_BRANCHES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const single = arg('peer') || process.env.PEER_BRANCH;
  const all = single ? [...fromConfig, single, ...extra] : [...fromConfig, ...extra];

  return [...new Set(all)].filter((ref) => ref !== `origin/${branchName}`);
}

function main(): void {
  loadLocalEnv();

  const { integrationBranch } = loadMachinesConfig();
  const integration =
    arg('integration') || process.env.INTEGRATION_BRANCH || integrationBranch;
  const current = 'HEAD';
  const integrationRef = refExists(`origin/${integration}`)
    ? `origin/${integration}`
    : integration;

  try {
    git('git fetch origin --quiet');
  } catch {
    // offline ou sem remote — segue com refs locais
  }

  if (!refExists(integrationRef)) {
    console.error(`Branch de integração não encontrada: ${integrationRef}`);
    process.exit(1);
  }

  const branchName = git('git rev-parse --abbrev-ref HEAD');
  const peerRefs = resolvePeerRefs(branchName).filter((ref) => refExists(ref));

  if (peerRefs.length === 0) {
    console.log('Nenhuma branch par encontrada no remoto.');
    console.log('Ajuste scripts/git-machines.json ou PEER_BRANCH em branch-peer.local.env');
    process.exit(0);
  }

  const baseCurrent = git(`git merge-base "${integrationRef}" "${current}"`);
  const mine = changedFilesSince(baseCurrent, current);

  console.log('--- check-branch-overlap ---');
  console.log(`Integração: ${integrationRef}`);
  console.log(`Branch atual: ${branchName}`);
  console.log(`Arquivos só na atual: ${mine.size}`);
  console.log(`Branches par: ${peerRefs.join(', ')}`);

  let exitCode = 0;
  for (const peer of peerRefs) {
    const basePeer = git(`git merge-base "${integrationRef}" "${peer}"`);
    const theirs = changedFilesSince(basePeer, peer);
    const overlap = [...mine].filter((f) => theirs.has(f)).sort();

    console.log(`\n--- vs ${peer} ---`);
    console.log(`Arquivos só na par: ${theirs.size}`);
    console.log(`Sobreposição:       ${overlap.length}`);

    if (overlap.length === 0) {
      console.log('OK — nenhum arquivo em comum neste intervalo.');
      continue;
    }

    exitCode = 2;
    console.log('Arquivos que AMBAS alteraram (revisar antes do merge):');
    for (const f of overlap) {
      console.log(`  ${f}`);
    }
    console.log(
      `Sugestão: git diff ${integrationRef}...HEAD -- <arquivo> e git diff ${integrationRef}...${peer} -- <arquivo>`
    );
  }

  if (exitCode === 0) {
    console.log('\nOK — sem sobreposição com nenhuma branch par.');
  }
  process.exit(exitCode);
}

main();
