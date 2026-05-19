import '../styles/login.css';
import { APP_VERSION } from '../generated/version.js';
import { apiRequest } from '../api/client.js';
import { navigate } from '../router.js';
import { isAuthenticated, setToken, setUser } from '../auth/session.js';

const EYE_OPEN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const EYE_CLOSED = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

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
        <form id="login-form" method="post" autocomplete="on">
          <div class="form-group">
            <label for="email">E-mail corporativo</label>
            <input
              type="email"
              id="email"
              name="username"
              class="form-control login-field"
              placeholder="usuario@empresa.com.br"
              required
              autocomplete="username"
              value=""
            />
          </div>
          <div class="form-group">
            <label for="password">Senha de acesso</label>
            <input
              type="password"
              id="password"
              name="password"
              class="form-control login-field"
              placeholder="Sua senha"
              required
              autocomplete="current-password"
              value=""
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
  const emailInput = container.querySelector('#email');
  const pwdInput = container.querySelector('#password');
  const togglePwd = container.querySelector('#toggle-pwd');

  /** Evita autopreenchimento do admin ao abrir a tela; o gerenciador de senhas ainda funciona ao focar. */
  for (const input of container.querySelectorAll('.login-field')) {
    input.setAttribute('readonly', 'readonly');
    input.addEventListener('focus', () => input.removeAttribute('readonly'), { once: true });
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    btnLogin.disabled = true;
    btnLogin.textContent = 'Autenticando...';

    try {
      const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email: emailInput.value.trim(), password: pwdInput.value },
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
  });
}
