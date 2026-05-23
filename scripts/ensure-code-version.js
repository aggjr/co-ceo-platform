/**
 * Detecta se a branch local está atrás de origin/<integração> pela versão (version.json)
 * e, por padrão, faz fetch + merge para trazer o código novo.
 *
 * Uso:
 *   node scripts/ensure-code-version.js           # alinha se atrasado
 *   node scripts/ensure-code-version.js --check   # só reporta (exit 3 se atrasado)
 */
const { execSync } = require('child_process');
const path = require('path');
const { loadGitMachinesConfig } = require('./lib/git-machines');
const {
  compareSemver,
  formatVersion,
  readVersionJsonFile,
  readVersionFromGitRef,
} = require('./lib/version');

const root = path.join(__dirname, '..');
const checkOnly = process.argv.includes('--check');

const BRANCH_ALIASES = {
  'atigravity-gamer': 'antigravity-gamer',
  'atigravity-guto': 'antigravity-guto',
};

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

function git(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
}

function normalizeBranch(name) {
  const key = String(name || '').trim().replace(/^origin\//, '');
  return BRANCH_ALIASES[key] || key;
}

function resolveMachineBranch() {
  if (process.env.COCEO_MACHINE_BRANCH) {
    return normalizeBranch(process.env.COCEO_MACHINE_BRANCH);
  }
  try {
    const fromGit = git('git config --get coceo.machineBranch');
    if (fromGit) return normalizeBranch(fromGit);
  } catch {
    /* ok */
  }
  const current = normalizeBranch(git('git rev-parse --abbrev-ref HEAD'));
  const { machineBranches } = loadGitMachinesConfig();
  if (machineBranches.includes(current)) return current;
  return null;
}

function integrationBranch() {
  if (process.env.COCEO_INTEGRATION_BRANCH) {
    return process.env.COCEO_INTEGRATION_BRANCH.trim();
  }
  try {
    const fromGit = git('git config --get coceo.integrationBranch');
    if (fromGit) return fromGit.trim();
  } catch {
    /* ok */
  }
  return loadGitMachinesConfig().integrationBranch;
}

function main() {
  const integration = integrationBranch();
  const integrationRef = `origin/${integration}`;
  const machine = resolveMachineBranch();

  if (!machine) {
    console.error(
      'Branch do agente indefinida. Use COCEO_MACHINE_BRANCH ou git config coceo.machineBranch.'
    );
    process.exit(1);
  }

  run('git fetch origin');

  const localPath = path.join(root, 'version.json');
  const local = readVersionJsonFile(localPath);
  const remote = readVersionFromGitRef(root, integrationRef, 'version.json');

  if (!local) {
    console.error('version.json local inválido ou ausente.');
    process.exit(1);
  }
  if (!remote) {
    console.log(`Sem ${integrationRef}:version.json — nada a comparar.`);
    process.exit(0);
  }

  const localLabel = formatVersion(local);
  const remoteLabel = formatVersion(remote);
  const cmp = compareSemver(local, remote);

  if (cmp >= 0) {
    console.log(`OK — ${machine} em ${localLabel} (>= ${integrationRef} ${remoteLabel}).`);
    process.exit(0);
  }

  console.log('');
  console.log(`VERSÃO ATRASADA: local ${localLabel} < ${integrationRef} ${remoteLabel}`);
  console.log('');

  if (checkOnly) {
    console.log('Rode: npm run git:ensure-version');
    process.exit(3);
  }

  const current = normalizeBranch(git('git rev-parse --abbrev-ref HEAD'));
  if (current !== machine) {
    console.log(`Checkout ${machine}...`);
    run(`git checkout ${machine}`);
  }

  console.log(`Merge ${integrationRef} -> ${machine}...`);
  try {
    run(
      `git merge ${integrationRef} -m "merge(${machine}): alinhar versao com ${integration} (${localLabel} -> ${remoteLabel})"`
    );
  } catch {
    console.error('');
    console.error('CONFLITO ao atualizar versão. Resolva e commit o merge antes de continuar.');
    process.exit(1);
  }

  const after = readVersionJsonFile(localPath);
  console.log('');
  console.log(
    `Atualizado: ${formatVersion(after || remote)} (integrado de ${integrationRef}).`
  );
  process.exit(0);
}

main();
