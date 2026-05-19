export function buildImpersonationLines(me) {
  const user = me?.user;
  const name =
    user?.fullName || user?.preferredName || user?.email || 'colaborador';
  const org = me?.organizationName || 'unidade não informada';
  return {
    line1: `Usuário emulado: ${name}`,
    line2: `Unidade: ${org}`,
  };
}

export function formatOriginalSessionLines(meta) {
  if (!meta) return null;
  const name = meta.fullName || meta.email || 'usuário';
  const org =
    meta.organizationName ||
    (meta.scope === 'global' ? 'Plataforma co-CEO' : 'unidade não informada');
  return {
    line1: `Usuário original: ${name}`,
    line2: `Unidade de login: ${org}`,
  };
}
