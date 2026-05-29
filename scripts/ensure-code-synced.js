/**
 * Garante que o clone local esta alinhado com origin/main (versao + commits).
 * O agente deve rodar no inicio de tarefas de codigo e sempre que suspeitar versao velha.
 *
 *   npm run git:ensure-sync
 *   node scripts/ensure-code-synced.js --check-only
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const checkOnly = process.argv.includes('--check-only');

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
}

function runQuiet(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return null;
  }
}

function readVersionFromJson(text) {
  const v = JSON.parse(text);
  return { major: +v.major, minor: +v.minor, patch: +v.patch };
}

function semverLabel(v) {
  return `V${v.major}.${v.minor}.${v.patch}`;
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function main() {
  const integration = runQuiet('git config --get coceo.integrationBranch') || 'main';
  const machine = runQuiet('git config --get coceo.machineBranch');
  const remoteRef = `origin/${integration}`;

  if (!runQuiet(`git rev-parse --verify ${remoteRef}`)) {
    console.error(`[git:ensure-sync] Ref remota ausente: ${remoteRef}. Rode: git fetch origin`);
    process.exit(1);
  }

  run('git fetch origin', { silent: true });

  const localText = fs.readFileSync(path.join(root, 'version.json'), 'utf8');
  const localVer = readVersionFromJson(localText);
  const remoteText = runQuiet(`git show ${remoteRef}:version.json`);
  if (!remoteText) {
    console.error('[git:ensure-sync] Nao foi possivel ler version.json em', remoteRef);
    process.exit(1);
  }
  const remoteVer = readVersionFromJson(remoteText);

  const behindCount = Number(runQuiet(`git rev-list --count HEAD..${remoteRef}`) || '0');
  const versionBehind = compareSemver(localVer, remoteVer) < 0;
  const needsSync = versionBehind || behindCount > 0;

  console.log(`[git:ensure-sync] Local ${semverLabel(localVer)} | ${remoteRef} ${semverLabel(remoteVer)} | commits atras: ${behindCount}`);

  if (!needsSync) {
    console.log('[git:ensure-sync] OK — codigo ja alinhado com', remoteRef);
    process.exit(0);
  }

  if (checkOnly) {
    console.error(
      `[git:ensure-sync] DESATUALIZADO — rode: npm run git:ensure-sync (local ${semverLabel(localVer)} < ${semverLabel(remoteVer)} ou ${behindCount} commit(s) atras)`
    );
    process.exit(2);
  }

  const porcelain = runQuiet('git status --porcelain');
  const dirtyTracked = porcelain
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith('??'));
  if (dirtyTracked.length) {
    console.error('[git:ensure-sync] Working tree suja. Commit ou descarte mudancas antes de puxar main.');
    console.error(dirtyTracked.slice(0, 15).join('\n'));
    process.exit(1);
  }

  const current = runQuiet('git branch --show-current');
  const targetBranch = machine || current;
  if (!targetBranch) {
    console.error('[git:ensure-sync] Branch atual desconhecida. Defina: git config coceo.machineBranch <sua-branch>');
    process.exit(1);
  }

  if (current !== targetBranch) {
    console.log(`[git:ensure-sync] Checkout ${targetBranch}`);
    run(`git checkout ${targetBranch}`);
  }

  console.log(`[git:ensure-sync] Merge ${remoteRef} -> ${targetBranch}`);
  try {
    run(`git merge ${remoteRef} -m "merge(${targetBranch}): alinhar com ${integration} (${semverLabel(remoteVer)})"`);
  } catch {
    console.error('[git:ensure-sync] CONFLITO no merge. Resolva, git add, git commit, e continue a tarefa.');
    process.exit(1);
  }

  const afterText = fs.readFileSync(path.join(root, 'version.json'), 'utf8');
  const afterVer = readVersionFromJson(afterText);
  console.log(`[git:ensure-sync] OK — agora em ${semverLabel(afterVer)}`);
}

main();
