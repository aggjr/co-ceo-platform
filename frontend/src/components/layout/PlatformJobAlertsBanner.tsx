import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { apiRequest } from '../../api/client.js';
import { getActiveContext } from '../../auth/session.js';
import '../../styles/platform-job-alerts.css';

type JobAlert = {
  id: string;
  jobKey: string;
  severity: string;
  title: string;
  body: string;
  createdAt: string;
};

export function PlatformJobAlertsBanner() {
  const [alerts, setAlerts] = createSignal<JobAlert[]>([]);
  const [loading, setLoading] = createSignal(false);

  const isPlatformUser = () => getActiveContext()?.scope === 'global';

  const load = async () => {
    if (!isPlatformUser()) {
      setAlerts([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiRequest('/api/platform/job-alerts?limit=10');
      setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  };

  const acknowledge = async (id: string) => {
    try {
      await apiRequest(`/api/platform/job-alerts/${encodeURIComponent(id)}/acknowledge`, {
        method: 'POST',
      });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error('[platform-alerts] acknowledge failed', err);
    }
  };

  onMount(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60_000);
    onCleanup(() => window.clearInterval(timer));
  });

  return (
    <Show when={isPlatformUser() && alerts().length > 0}>
      <div class="platform-job-alerts" role="alert" aria-live="polite">
        <div class="platform-job-alerts__head">
          <strong>Jobs da plataforma</strong>
          <span class="platform-job-alerts__hint">
            {loading() ? 'Atualizando…' : `${alerts().length} pendente(s)`}
          </span>
        </div>
        <ul class="platform-job-alerts__list">
          <For each={alerts()}>
            {(item) => (
              <li class={`platform-job-alerts__item platform-job-alerts__item--${item.severity}`}>
                <div class="platform-job-alerts__text">
                  <span class="platform-job-alerts__title">{item.title}</span>
                  <span class="platform-job-alerts__body">{item.body}</span>
                </div>
                <button
                  type="button"
                  class="platform-job-alerts__ack"
                  onClick={() => void acknowledge(item.id)}
                >
                  Ok, vi
                </button>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
}
