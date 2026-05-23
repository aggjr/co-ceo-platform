const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'git-machines.json');

function loadGitMachinesConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const cfg = JSON.parse(raw);
  const integrationBranch = String(cfg.integrationBranch || 'main').trim();
  const machineBranches = (cfg.machineBranches || [])
    .map((b) => String(b).trim())
    .filter(Boolean);
  if (!machineBranches.length) {
    throw new Error('git-machines.json: machineBranches vazio');
  }
  return { integrationBranch, machineBranches };
}

/** Branches de trabalho no remoto, exceto a da máquina atual. */
function peerRemoteRefs(machineBranch) {
  const { machineBranches } = loadGitMachinesConfig();
  const self = String(machineBranch || '').trim();
  return machineBranches
    .filter((b) => b !== self)
    .map((b) => `origin/${b}`);
}

module.exports = {
  loadGitMachinesConfig,
  peerRemoteRefs,
};
