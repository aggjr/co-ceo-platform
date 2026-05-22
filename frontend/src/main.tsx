import { render } from 'solid-js/web';
import { App } from './App';
import './styles/app.css';
import './styles/loader.css';
import './styles/coceo-excel-table.css';
import './styles/coceo-excel-global.css';
import './styles/invest-portfolio.css';
import { consumeImpersonationHandoff, resetAuthOnPageReload } from './auth/session.js';
import { refreshSessionState } from './shell/shellState';
import { initTelemetry } from './telemetry/index.js';

if (consumeImpersonationHandoff()) {
  refreshSessionState();
}
resetAuthOnPageReload();
initTelemetry();

const root = document.getElementById('app');
if (!root) {
  throw new Error('Elemento #app não encontrado.');
}

render(() => <App />, root);
