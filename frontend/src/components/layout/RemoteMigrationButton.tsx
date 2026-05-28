import { createSignal, Show } from 'solid-js';
import { apiRequest } from '../../api/client.js';

export function RemoteMigrationButton() {
  const [loading, setLoading] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal('');

  const runMigration = async () => {
    if (!confirm('Deseja iniciar a migração e reconstrução de dados no servidor? Isso pode demorar 1-2 minutos.')) return;
    
    setLoading(true);
    setErrorMsg('');
    setDone(false);

    try {
      await apiRequest('/api/invest/admin/migrate-remote', {
        method: 'POST',
      });
      setDone(true);
      alert('Migração concluída com sucesso! Os gráficos devem estar corretos agora.');
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Erro desconhecido');
      alert(`Falha na migração: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ "margin-right": "16px", display: "flex", "align-items": "center", gap: "8px" }}>
      <button 
        type="button" 
        onClick={runMigration}
        disabled={loading() || done()}
        style={{
          padding: '6px 12px',
          "background-color": done() ? '#28a745' : '#e67e22',
          color: '#fff',
          border: 'none',
          "border-radius": '4px',
          cursor: loading() || done() ? 'not-allowed' : 'pointer',
          "font-weight": "bold",
          "font-size": "13px"
        }}
      >
        <Show when={!loading() && !done()}>Rodar Migração Servidor</Show>
        <Show when={loading()}>Migrando... (aguarde)</Show>
        <Show when={done()}>Migração OK</Show>
      </button>
      <Show when={errorMsg()}>
        <span style={{ color: '#e74c3c', "font-size": "12px" }}>Erro! Tente novamente.</span>
      </Show>
    </div>
  );
}
