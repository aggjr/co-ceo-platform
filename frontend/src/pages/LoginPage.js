import '../styles/login.css';
import { APP_VERSION } from '../generated/version.js';
import { applyAppVersionToDom } from '../lib/appVersion.js';
import { apiRequest } from '../api/client.js';
import { navigate } from '../router.js';
import { isAuthenticated, setToken, setUser } from '../auth/session.js';

const EYE_OPEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const EYE_CLOSED = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

const AUTOFILL_WAIT_MS = 1000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fieldAutofilled(el) {
  if (!el) return false;
  try {
    return el.matches(':-webkit-autofill');
  } catch {
    return false;
  }
}

export async function LoginPage(container) {
  if (isAuthenticated()) {
    navigate('/cockpit');
    return;
  }

  container.innerHTML = `
    <div class="login-screen">
      <div class="bg-shape"></div>
      <div class="login-card">
        <div class="logo-container">
          <div class="logo">CO<span>-</span>CEO</div>
          <div class="subtitle">Decisão, estoque e operações</div>
        </div>
        <div id="login-error"></div>
        <form id="login-form" method="post" action="/login" autocomplete="on" novalidate>
          <div class="form-group">
            <label for="login-username">E-mail corporativo</label>
            <input
              type="text"
              id="login-username"
              name="username"
              class="form-control login-field login-field--username"
              placeholder="usuario@empresa.com.br"
              autocomplete="username"
              inputmode="email"
              autocapitalize="off"
              spellcheck="false"
              aria-label="E-mail corporativo"
            />
          </div>
          <div class="form-group">
            <label for="login-password">Senha de acesso</label>
            <input
              type="password"
              id="login-password"
              name="password"
              class="form-control login-field login-field--password"
              placeholder="Sua senha"
              autocomplete="current-password"
              aria-label="Senha de acesso"
            />
            <span class="password-toggle" id="toggle-pwd" title="Mostrar senha">${EYE_CLOSED}</span>
          </div>
          <button type="submit" class="btn-login" id="btn-login">ACESSAR PLATAFORMA</button>
        </form>
        <div class="card-footer" id="login-footer">
          <a href="#">Esqueceu a senha?</a>
          <span class="separator">|</span>
          <a href="#">Suporte</a>
        </div>
        <p class="card-version" aria-label="Versão do sistema">${APP_VERSION}</p>
      </div>
    </div>
  `;

  const errEl = container.querySelector('#login-error');
  const form = container.querySelector('#login-form');
  const btnLogin = container.querySelector('#btn-login');
  const emailInput = container.querySelector('#login-username');
  const pwdInput = container.querySelector('#login-password');
  const togglePwd = container.querySelector('#toggle-pwd');

  void applyAppVersionToDom(container);

  const readCredentialsFromDom = () => {
    const fd = new FormData(form);
    const email = String(fd.get('username') ?? emailInput?.value ?? '').trim();
    const password = String(fd.get('password') ?? pwdInput?.value ?? '');
    return { email, password };
  };

  /** Chrome preenche senha antes do e-mail; aguarda o par completo. */
  const waitForCredentials = async (maxMs = AUTOFILL_WAIT_MS) => {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      const creds = readCredentialsFromDom();
      if (creds.email && creds.password) return creds;

      const pwdReady = Boolean(creds.password) || fieldAutofilled(pwdInput);
      const emailReady = Boolean(creds.email) || fieldAutofilled(emailInput);

      if (pwdReady && !creds.email) {
        emailInput?.dispatchEvent(new Event('input', { bubbles: true }));
        emailInput?.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (pwdReady || emailReady) {
        await delay(50);
        continue;
      }
      await delay(40);
    }
    return readCredentialsFromDom();
  };

  let autofillSyncTimer = null;
  const scheduleAutofillSync = () => {
    if (autofillSyncTimer) clearTimeout(autofillSyncTimer);
    autofillSyncTimer = setTimeout(() => {
      void waitForCredentials(400);
    }, 80);
  };

  for (const input of [emailInput, pwdInput]) {
    if (!input) continue;
    input.addEventListener('input', scheduleAutofillSync);
    input.addEventListener('change', scheduleAutofillSync);
    input.addEventListener('animationstart', (ev) => {
      if (ev.animationName === 'coceo-login-autofill') scheduleAutofillSync();
    });
  }

  togglePwd?.addEventListener('click', () => {
    const show = pwdInput.type === 'password';
    pwdInput.type = show ? 'text' : 'password';
    togglePwd.innerHTML = show ? EYE_OPEN : EYE_CLOSED;
    togglePwd.title = show ? 'Ocultar senha' : 'Mostrar senha';
  });

  const showError = (msg) => {
    errEl.innerHTML = msg ? `<div class="login-error">${msg}</div>` : '';
  };

  const runLogin = async () => {
    showError('');
    btnLogin.disabled = true;
    btnLogin.textContent = 'Autenticando...';

    try {
      const { email, password } = await waitForCredentials();

      if (!email) {
        showError(
          'E-mail ainda não foi lido pelo navegador. Aguarde um instante após escolher o login salvo ou digite o e-mail.'
        );
        emailInput?.focus();
        return;
      }
      if (!password) {
        showError('Informe a senha de acesso.');
        pwdInput?.focus();
        return;
      }

      const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email, password },
        auth: false,
      });

      if (data.user) setUser(data.user);

      if (data.token) {
        setToken(data.token);
        navigate('/cockpit');
        return;
      }

      showError('Resposta de login inválida.');
    } catch (err) {
      showError(err.message || 'Falha no login.');
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = 'ACESSAR PLATAFORMA';
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void runLogin();
  });
}
