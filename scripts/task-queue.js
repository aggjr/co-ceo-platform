/**
 * Fila central — fonte humana: tasks/FILA.md
 *
 *   npm run task:list
 *   npm run task:add -- --id W2-02 --title "..." --spec tasks/wave-2/02.md --priority 50
 *   npm run task:claim
 *   npm run task:done -- --id W2-02
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const filaPath = path.join(root, 'tasks', 'FILA.md');
const queuePath = path.join(root, 'tasks', 'queue.json');
const boardPath = path.join(root, 'tasks', 'QUEUE.md');
const ACTIVE = new Set(['claimed', 'in_progress']);
const FILA_HEADER = `# Fila de trabalho

> **Arquiteto (Augusto):** descreva as proximas tarefas nos blocos \`## ID\` abaixo (texto livre + campos).  
> **Agentes:** usem \`npm run task:claim\` — o script atualiza \`status\` / \`agente\` e publica em \`main\`. Nao marquem claim a mao.

Copie o bloco modelo, cole no fim da lista e preencha.

---

## _MODELO

prioridade: 50
status: pending
agente:
spec:
assumida:
concluida:
release:

titulo: Titulo curto para o quadro

Descreva aqui o trabalho em quantos paragrafos precisar.
Criterio de aceite, arquivos, banco remoto, etc.

---

`;

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

function parseFieldsAndBody(blockLines) {
  const fields = {};
  const body = [];
  for (const line of blockLines) {
    const kv = line.match(/^(prioridade|status|agente|spec|assumida|concluida|release|titulo):\s*(.*)$/i);
    if (kv) {
      fields[kv[1].toLowerCase()] = kv[2].trim();
    } else {
      body.push(line);
    }
  }
  while (body.length && body[0].trim() === '') body.shift();
  while (body.length && body[body.length - 1].trim() === '') body.pop();
  return { fields, body };
}

function parseFila(content) {
  const tasks = [];
  const chunks = content.split(/\n(?=## )/);
  for (const chunk of chunks) {
    if (!chunk.startsWith('## ')) continue;
    const lines = chunk.split('\n');
    const id = lines[0].replace(/^##\s+/, '').trim();
    if (!id || id === '_MODELO' || id.startsWith('_')) continue;
    const { fields, body } = parseFieldsAndBody(lines.slice(1));
    const description = body.join('\n');
    const firstBodyLine = body.find((l) => l.trim()) || '';
    tasks.push({
      id,
      title: fields.titulo || firstBodyLine.slice(0, 120) || id,
      spec: fields.spec || null,
      priority: Number(fields.prioridade || 0),
      status: (fields.status || 'pending').toLowerCase(),
      claimed_by: fields.agente || null,
      claimed_at: fields.assumida || null,
      started_at: null,
      completed_at: fields.concluida || null,
      release_version: fields.release || null,
      description,
      notes: '',
    });
  }
  return tasks;
}

function taskToBlock(t) {
  const lines = [
    `## ${t.id}`,
    '',
    `prioridade: ${t.priority ?? 0}`,
    `status: ${t.status}`,
    `agente: ${t.claimed_by || ''}`,
    `spec: ${t.spec || ''}`,
    `assumida: ${t.claimed_at || ''}`,
    `concluida: ${t.completed_at || ''}`,
    `release: ${t.release_version || ''}`,
    '',
    `titulo: ${t.title}`,
    '',
  ];
  if (t.description) {
    lines.push(t.description);
    if (!t.description.endsWith('\n')) lines.push('');
  }
  return lines.join('\n');
}

function serializeFila(tasks) {
  const real = tasks.filter((t) => t.id !== '_MODELO');
  const blocks = real
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.id).localeCompare(String(b.id)))
    .map(taskToBlock);
  return `${FILA_HEADER}${blocks.length ? `${blocks.join('\n---\n\n')}\n` : ''}`;
}

function readQueue() {
  if (fs.existsSync(filaPath)) {
    const tasks = parseFila(fs.readFileSync(filaPath, 'utf8'));
    return { schema_version: 1, updated_at: new Date().toISOString(), tasks };
  }
  if (fs.existsSync(queuePath)) {
    return JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  }
  return { schema_version: 1, updated_at: new Date().toISOString(), tasks: [] };
}

function writeQueue(queue) {
  queue.updated_at = new Date().toISOString();
  fs.writeFileSync(filaPath, serializeFila(queue.tasks), 'utf8');
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
    '# Quadro resumo (gerado)',
    '',
    `> De \`tasks/FILA.md\` em **${queue.updated_at}**. Edite a fila em **FILA.md**, nao aqui.`,
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
  lines.push('');
  fs.writeFileSync(boardPath, lines.join('\n'), 'utf8');
}

function escapeCell(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 16).replace('T', ' ');
}

function printList(queue) {
  const rows = queue.tasks
    .slice()
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || String(a.id).localeCompare(String(b.id)));
  if (!rows.length) {
    console.log('[task-queue] Fila vazia. Escreva em tasks/FILA.md ou: npm run task:add -- --id ... --title "..."');
    return;
  }
  console.log('ID\tP\tStatus\t\tAgente\t\tTitulo');
  for (const t of rows) {
    console.log(`${t.id}\t${t.priority ?? 0}\t${t.status.padEnd(12)}\t${(t.claimed_by || '—').padEnd(12)}\t${t.title}`);
  }
}

const QUEUE_FILES = ['tasks/FILA.md', 'tasks/queue.json', 'tasks/QUEUE.md'];

function ensureCleanForPublish() {
  const porcelain = runQuiet('git status --porcelain');
  if (!porcelain) return;
  const onlyQueue = porcelain
    .split('\n')
    .filter(Boolean)
    .every((line) => {
      const trimmed = String(line || '').trim();
      if (trimmed.startsWith('??')) return true;
      // git porcelain is typically: "XY path". Be robust across environments
      // that may render variable spacing or collapse the 2nd status column.
      const parts = trimmed.split(/\s+/);
      parts.shift(); // status
      let file = parts.join(' ').trim();
      if (!file) file = trimmed.slice(3).trim();
      if (file.includes('->')) file = file.split('->').pop().trim();
      return QUEUE_FILES.includes(file);
    });
  if (!onlyQueue) {
    console.error('[task-queue] Working tree suja (alem da fila). Commit ou descarte antes.');
    console.error(porcelain.split('\n').slice(0, 12).join('\n'));
    process.exit(1);
  }
}

function publishQueue(commitMsg) {
  ensureCleanForPublish();
  run(`git add ${QUEUE_FILES.join(' ')}`);
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
  run(`git checkout -- ${QUEUE_FILES.join(' ')}`, { silent: true });
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
    description: args.notes || title,
    notes: '',
  });
  writeQueue(queue);
  publishQueue(`chore(tasks): adicionar ${id} na fila`);
  console.log(`[task-queue] Adicionada em tasks/FILA.md: ${id}`);
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
      console.log(`[task-queue] Detalhes: tasks/FILA.md ## ${current.id}`);
      return;
    }

    const next = pickNext(queue);
    if (!next) {
      console.log('[task-queue] Nenhuma tarefa pending em tasks/FILA.md');
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
      console.log(`[task-queue] Detalhes: tasks/FILA.md ## ${next.id}`);
      return;
    } catch {
      console.error(`[task-queue] Conflito ao publicar claim (tentativa ${attempt}/${maxRetries}). Realinhando...`);
      discardQueueChanges();
    }
  }
  console.error('[task-queue] Nao foi possivel publicar o claim. Resolva conflitos em tasks/FILA.md e tente de novo.');
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
  task.description = `${task.description}\n\n[${stamp}] Liberado: ${reason}`.trim();
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
  writeQueue(queue);
  console.log('[task-queue] FILA.md / queue.json / QUEUE.md sincronizados.');
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
