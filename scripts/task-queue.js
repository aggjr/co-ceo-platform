/**
 * Fila central de tarefas para multiplos agentes/máquinas.
 *
 *   npm run task:list
 *   npm run task:add -- --id W2-02 --title "..." --spec tasks/wave-2/02.md --priority 50
 *   npm run task:claim
 *   npm run task:start -- --id W2-02
 *   npm run task:done -- --id W2-02
 *   npm run task:release -- --id W2-02 --reason "bloqueado: falta spec"
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const queuePath = path.join(root, 'tasks', 'queue.json');
const boardPath = path.join(root, 'tasks', 'QUEUE.md');
const ACTIVE = new Set(['claimed', 'in_progress']);

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
}

function runQuiet(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function resolveAgent(args) {
  if (args.agent) return args.agent;
  const cfg = runQuiet('git config --get coceo.machineBranch');
  if (cfg) return cfg;
  console.error('[task-queue] Defina o agente: --agent note-guto ou git config coceo.machineBranch <branch>');
  process.exit(1);
}

function readQueue() {
  if (!fs.existsSync(queuePath)) {
    return { schema_version: 1, updated_at: new Date().toISOString(), tasks: [] };
  }
  return JSON.parse(fs.readFileSync(queuePath, 'utf8'));
}

function writeQueue(queue) {
  queue.updated_at = new Date().toISOString();
  fs.writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
  writeBoard(queue);
}

function pickNext(queue) {
  return queue.tasks
    .filter((t) => t.status === 'pending')
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.id).localeCompare(String(b.id)))[0];
}

function findTask(queue, id) {
  const t = queue.tasks.find((x) => x.id === id);
  if (!t) {
    console.error(`[task-queue] Tarefa nao encontrada: ${id}`);
    process.exit(1);
  }
  return t;
}

function activeForAgent(queue, agent) {
  return queue.tasks.find((t) => t.claimed_by === agent && ACTIVE.has(t.status));
}

function readVersionLabel() {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  return `V${v.major}.${v.minor}.${v.patch}`;
}

function writeBoard(queue) {
  const rows = queue.tasks
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.id).localeCompare(String(b.id)));

  const lines = [
    '# Fila de trabalho — agentes',
    '',
    `> Gerado em **${queue.updated_at}** a partir de \`tasks/queue.json\`. **Nao edite esta tabela a mao.**`,
    '',
    '| ID | P | Titulo | Spec | Status | Agente | Assumida | Concluida | Release |',
    '|----|---|--------|------|--------|--------|----------|-----------|---------|',
  ];

  if (rows.length === 0) {
    lines.push('| — | — | *(fila vazia)* | — | — | — | — | — | — |');
  } else {
    for (const t of rows) {
      lines.push(
        `| ${t.id} | ${t.priority ?? 0} | ${escapeCell(t.title)} | ${escapeCell(t.spec || '—')} | ${t.status} | ${t.claimed_by || '—'} | ${fmtDate(t.claimed_at)} | ${fmtDate(t.completed_at)} | ${t.release_version || '—'} |`
      );
    }
  }

  lines.push(
    '',
    '## Arquiteto — adicionar tarefa',
    '',
    '```bash',
    'npm run task:add -- --id W3-01 --title "Barramento canonico INVEST" --spec tasks/wave-3/01.md --priority 80',
    '```',
    '',
    'Ou edite `tasks/queue.json` (novo item com `"status": "pending"`) e rode `npm run task:sync`.',
    '',
    '## Agente — ritmo',
    '',
    '1. `npm run git:ensure-sync`',
    '2. `npm run task:claim` — assume a proxima `pending` e publica em `main`',
    '3. Implementar spec, banco/scripts se a task pedir, testes verdes',
    '4. `npm run git:ship -- -Message "..."` apos alteracao de codigo',
    '5. `npm run task:done -- --id <ID>`',
    '',
    'Se travar: `npm run task:release -- --id <ID> --reason "..."`',
    ''
  );

  fs.writeFileSync(boardPath, lines.join('\n'), 'utf8');
}

function escapeCell(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ');
}

function printList(queue) {
  const rows = queue.tasks
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.id).localeCompare(String(b.id)));
  if (!rows.length) {
    console.log('[task-queue] Fila vazia. Adicione com: npm run task:add -- --id ... --title "..."');
    return;
  }
  console.log('ID\tP\tStatus\t\tAgente\t\tTitulo');
  for (const t of rows) {
    console.log(`${t.id}\t${t.priority ?? 0}\t${t.status.padEnd(12)}\t${(t.claimed_by || '—').padEnd(12)}\t${t.title}`);
  }
}

function ensureCleanForPublish() {
  const porcelain = runQuiet('git status --porcelain');
  if (!porcelain) return;
  const onlyQueue = porcelain
    .split('\n')
    .filter(Boolean)
    .every((line) => {
      const file = line.slice(3).trim();
      return file === 'tasks/queue.json' || file === 'tasks/QUEUE.md';
    });
  if (!onlyQueue) {
    console.error('[task-queue] Working tree suja (alem da fila). Commit ou descarte antes.');
    console.error(porcelain.split('\n').slice(0, 12).join('\n'));
    process.exit(1);
  }
}

function publishQueue(commitMsg) {
  ensureCleanForPublish();
  run('git add tasks/queue.json tasks/QUEUE.md');
  const staged = runQuiet('git diff --cached --name-only');
  if (!staged) {
    const porcelain = runQuiet('git status --porcelain');
    if (!porcelain) {
      console.log('[task-queue] Nada a publicar (fila ja commitada).');
      return false;
    }
  }
  const msg = commitMsg.replace(/"/g, '\\"');
  run(`npm run git:ship -- -Message "${msg}"`, { silent: false });
  return true;
}

function discardQueueChanges() {
  run('git checkout -- tasks/queue.json tasks/QUEUE.md', { silent: true });
}

function cmdAdd(args) {
  const id = args.id || args._[1];
  const title = args.title || args._[2];
  if (!id || !title) {
    console.error('Uso: npm run task:add -- --id W2-02 --title "Titulo" [--spec path] [--priority 50] [--notes "..."]');
    process.exit(1);
  }
  const queue = readQueue();
  if (queue.tasks.some((t) => t.id === id)) {
    console.error(`[task-queue] ID ja existe: ${id}`);
    process.exit(1);
  }
  queue.tasks.push({
    id,
    title,
    spec: args.spec || null,
    priority: Number(args.priority || 0),
    status: 'pending',
    claimed_by: null,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    release_version: null,
    notes: args.notes || '',
  });
  writeQueue(queue);
  publishQueue(`chore(tasks): adicionar ${id} na fila`);
  console.log(`[task-queue] Adicionada: ${id}`);
}

function cmdClaim(args) {
  const agent = resolveAgent(args);
  const maxRetries = 6;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    run('npm run git:ensure-sync', { silent: true });
    const queue = readQueue();

    const current = activeForAgent(queue, agent);
    if (current) {
      console.log(`[task-queue] ${agent} ja tem tarefa ativa: ${current.id} (${current.status})`);
      console.log(`[task-queue] Spec: ${current.spec || '(sem spec)'}`);
      return;
    }

    const next = pickNext(queue);
    if (!next) {
      console.log('[task-queue] Nenhuma tarefa pending na fila.');
      return;
    }

    next.status = 'claimed';
    next.claimed_by = agent;
    next.claimed_at = new Date().toISOString();
    writeQueue(queue);

    try {
      const published = publishQueue(`chore(tasks): ${agent} assume ${next.id}`);
      if (!published) {
        discardQueueChanges();
        continue;
      }
      console.log(`[task-queue] ${agent} assumiu: ${next.id} — ${next.title}`);
      if (next.spec) console.log(`[task-queue] Spec: ${next.spec}`);
      return;
    } catch {
      console.error(`[task-queue] Conflito ao publicar claim (tentativa ${attempt}/${maxRetries}). Realinhando...`);
      discardQueueChanges();
    }
  }
  console.error('[task-queue] Nao foi possivel publicar o claim apos varias tentativas. Resolva conflitos em tasks/queue.json e tente de novo.');
  process.exit(1);
}

function cmdStart(args) {
  const agent = resolveAgent(args);
  const id = args.id || args._[1];
  if (!id) {
    console.error('Uso: npm run task:start -- --id W2-02');
    process.exit(1);
  }
  const queue = readQueue();
  const task = findTask(queue, id);
  if (task.claimed_by && task.claimed_by !== agent) {
    console.error(`[task-queue] ${id} pertence a ${task.claimed_by}, nao a ${agent}`);
    process.exit(1);
  }
  task.status = 'in_progress';
  task.claimed_by = agent;
  if (!task.claimed_at) task.claimed_at = new Date().toISOString();
  task.started_at = new Date().toISOString();
  writeQueue(queue);
  publishQueue(`chore(tasks): ${agent} inicia ${id}`);
  console.log(`[task-queue] ${id} em andamento (${agent})`);
}

function cmdDone(args) {
  const agent = resolveAgent(args);
  const id = args.id || args._[1];
  if (!id) {
    console.error('Uso: npm run task:done -- --id W2-02');
    process.exit(1);
  }
  const queue = readQueue();
  const task = findTask(queue, id);
  if (task.claimed_by && task.claimed_by !== agent) {
    console.error(`[task-queue] ${id} pertence a ${task.claimed_by}, nao a ${agent}`);
    process.exit(1);
  }
  task.status = 'done';
  task.completed_at = new Date().toISOString();
  task.release_version = readVersionLabel();
  writeQueue(queue);
  publishQueue(`chore(tasks): ${agent} conclui ${id} (${task.release_version})`);
  console.log(`[task-queue] Concluida: ${id} @ ${task.release_version}`);
}

function cmdRelease(args) {
  const agent = resolveAgent(args);
  const id = args.id || args._[1];
  const reason = args.reason || 'sem motivo informado';
  if (!id) {
    console.error('Uso: npm run task:release -- --id W2-02 --reason "..."');
    process.exit(1);
  }
  const queue = readQueue();
  const task = findTask(queue, id);
  if (task.claimed_by && task.claimed_by !== agent) {
    console.error(`[task-queue] ${id} pertence a ${task.claimed_by}, nao a ${agent}`);
    process.exit(1);
  }
  const stamp = new Date().toISOString().slice(0, 16);
  task.notes = `${task.notes ? `${task.notes}\n` : ''}[${stamp}] ${agent} liberou: ${reason}`;
  task.status = 'pending';
  task.claimed_by = null;
  task.claimed_at = null;
  task.started_at = null;
  writeQueue(queue);
  publishQueue(`chore(tasks): ${agent} libera ${id} para fila`);
  console.log(`[task-queue] ${id} voltou para pending`);
}

function cmdSync() {
  const queue = readQueue();
  writeBoard(queue);
  console.log('[task-queue] QUEUE.md atualizado (rode commit+integrate se quiser publicar).');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'list';

  switch (cmd) {
    case 'list':
      printList(readQueue());
      break;
    case 'add':
      cmdAdd(args);
      break;
    case 'claim':
      cmdClaim(args);
      break;
    case 'start':
      cmdStart(args);
      break;
    case 'done':
      cmdDone(args);
      break;
    case 'release':
      cmdRelease(args);
      break;
    case 'sync':
      cmdSync();
      break;
    default:
      console.error(`Comando desconhecido: ${cmd}`);
      console.error('Comandos: list | add | claim | start | done | release | sync');
      process.exit(1);
  }
}

main();
