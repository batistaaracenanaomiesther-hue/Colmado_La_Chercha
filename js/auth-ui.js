(function () {
  const C = () => window.Colmado;

  function ensureAuthModal() {
    if (document.getElementById('auth-backdrop')) return;

    const backdrop = document.createElement('div');
    backdrop.id = 'auth-backdrop';
    backdrop.className = 'auth-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = `
      <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" class="auth-modal__close icon-btn" aria-label="Cerrar">✕</button>

        <div class="auth-modal__head">
          <h2 id="auth-title" class="auth-modal__title">Cuenta</h2>
          <p class="auth-modal__subtitle" id="auth-subtitle">Inicia sesión o crea una cuenta</p>
        </div>

        <div class="auth-tabs" role="tablist">
          <button type="button" class="auth-tab is-active" data-auth-tab="login" role="tab" aria-selected="true">Iniciar sesión</button>
          <button type="button" class="auth-tab" data-auth-tab="register" role="tab" aria-selected="false">Registrarse</button>
        </div>

        <div class="auth-slider-outer">
          <div class="auth-slider" id="auth-slider">
            <div class="auth-slide" data-slide="login">
              <form id="form-auth-login" class="auth-form" novalidate>
                <label for="auth-login-email">Correo</label>
                <input id="auth-login-email" type="email" autocomplete="email" required placeholder="tu@correo.com">

                <label for="auth-login-pass">Contraseña</label>
                <input id="auth-login-pass" type="password" autocomplete="current-password" required placeholder="••••••••">

                <p class="auth-msg" id="auth-login-msg"></p>
                <button type="submit" class="btn btn--primary btn--block">Entrar</button>
              </form>
            </div>
            <div class="auth-slide" data-slide="register">
              <form id="form-auth-register" class="auth-form" novalidate>
                <label for="auth-reg-name">Nombre</label>
                <input id="auth-reg-name" type="text" autocomplete="name" required placeholder="Tu nombre">

                <label for="auth-reg-phone">Teléfono (opcional)</label>
                <input id="auth-reg-phone" type="tel" autocomplete="tel" placeholder="809-000-0000">

                <label for="auth-reg-email">Correo</label>
                <input id="auth-reg-email" type="email" autocomplete="email" required placeholder="tu@correo.com">

                <label for="auth-reg-pass">Contraseña</label>
                <input id="auth-reg-pass" type="password" autocomplete="new-password" required minlength="6" placeholder="Mínimo 6 caracteres">

                <p class="auth-msg" id="auth-register-msg"></p>
                <button type="submit" class="btn btn--primary btn--block">Crear cuenta</button>
              </form>
            </div>
          </div>
        </div>

        <button type="button" class="auth-switch-link" id="auth-switch-link">
          <span class="auth-switch-link__static">¿No tienes cuenta?</span>
          <span class="auth-switch-link__action">Regístrate aquí</span>
        </button>
      </div>
    `;

    document.body.appendChild(backdrop);

    const slider = document.getElementById('auth-slider');
    const tabs = backdrop.querySelectorAll('[data-auth-tab]');
    const switchLink = document.getElementById('auth-switch-link');
    const subtitle = document.getElementById('auth-subtitle');

    function setMode(mode) {
      const isReg = mode === 'register';
      slider.classList.toggle('is-register', isReg);
      tabs.forEach((tab) => {
        const active = tab.getAttribute('data-auth-tab') === mode;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      if (isReg) {
        subtitle.textContent = 'Completa tus datos para registrarte';
        switchLink.innerHTML =
          '<span class="auth-switch-link__static">¿Ya tienes cuenta?</span><span class="auth-switch-link__action">Inicia sesión aquí</span>';
      } else {
        subtitle.textContent = 'Accede con tu correo y contraseña';
        switchLink.innerHTML =
          '<span class="auth-switch-link__static">¿No tienes cuenta?</span><span class="auth-switch-link__action">Regístrate aquí</span>';
      }
    }

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => setMode(tab.getAttribute('data-auth-tab')));
    });

    switchLink.addEventListener('click', () => {
      setMode(slider.classList.contains('is-register') ? 'login' : 'register');
    });

    backdrop.querySelector('.auth-modal__close').addEventListener('click', closeAuthModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeAuthModal();
    });

    document.getElementById('form-auth-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('auth-login-msg');
      msg.textContent = '';
      msg.className = 'auth-msg';
      try {
        const body = {
          email: document.getElementById('auth-login-email').value.trim(),
          password: document.getElementById('auth-login-pass').value,
        };
        const res = await C().api('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
        C().setUserSession(res.token, res.user);
        C().showToast('¡Bienvenido, ' + res.user.name + '!', 'ok');
        closeAuthModal();
        updateAuthButton();
      } catch (err) {
        msg.textContent = err.message || 'Error al iniciar sesión';
        msg.classList.add('auth-msg--err');
      }
    });

    document.getElementById('form-auth-register').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('auth-register-msg');
      msg.textContent = '';
      msg.className = 'auth-msg';
      try {
        const body = {
          name: document.getElementById('auth-reg-name').value.trim(),
          phone: document.getElementById('auth-reg-phone').value.trim(),
          email: document.getElementById('auth-reg-email').value.trim(),
          password: document.getElementById('auth-reg-pass').value,
        };
        const res = await C().api('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });
        C().setUserSession(res.token, res.user);
        C().showToast('Cuenta creada. ¡Hola, ' + res.user.name + '!', 'ok');
        closeAuthModal();
        updateAuthButton();
      } catch (err) {
        msg.textContent = err.message || 'No se pudo registrar';
        msg.classList.add('auth-msg--err');
      }
    });
  }

  function openAuthModal(preferRegister) {
    ensureAuthModal();
    const tab = document.querySelector(
      '[data-auth-tab="' + (preferRegister ? 'register' : 'login') + '"]'
    );
    if (tab) tab.click();
    document.getElementById('auth-backdrop').classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeAuthModal() {
    const b = document.getElementById('auth-backdrop');
    if (b) {
      b.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  }

  function updateAuthButton() {
    document.querySelectorAll('[data-auth-slot]').forEach((slot) => {
      const u = C().getUserProfile();
      if (u && u.name) {
        slot.innerHTML = `
          <span class="nav-user" title="${escapeAttr(u.email)}">
            <span class="nav-user__name">${escapeHtml(u.name)}</span>
            <button type="button" class="nav-user__out" data-auth-logout>Salir</button>
          </span>
        `;
        slot.querySelector('[data-auth-logout]').addEventListener('click', (e) => {
          e.preventDefault();
          C().clearUserSession();
          C().showToast('Sesión cerrada', 'ok');
          updateAuthButton();
        });
      } else {
        slot.innerHTML = `
          <button type="button" class="nav-auth-btn" data-open-auth="login">Entrar</button>
          <button type="button" class="btn btn--primary nav-register-btn" data-open-auth="register">Registrarse</button>
        `;
        slot.querySelectorAll('[data-open-auth]').forEach((btn) => {
          btn.addEventListener('click', () => openAuthModal(btn.getAttribute('data-open-auth') === 'register'));
        });
      }
    });
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function injectAuthNav() {
    if (document.getElementById('dash-app')) return;
    document.querySelectorAll('.site-nav').forEach((nav) => {
      if (nav.querySelector('[data-auth-slot]')) return;
      const cart = nav.querySelector('[data-open-cart]');
      const slot = document.createElement('div');
      slot.className = 'nav-auth-slot';
      slot.setAttribute('data-auth-slot', '');
      if (cart && cart.parentNode === nav) {
        nav.insertBefore(slot, cart);
      } else {
        nav.appendChild(slot);
      }
    });
    updateAuthButton();
  }

  async function refreshSession() {
    if (!C().getUserToken()) return;
    try {
      const u = await C().api('/api/auth/me');
      C().setUserSession(C().getUserToken(), u);
      updateAuthButton();
    } catch {
      C().clearUserSession();
      updateAuthButton();
    }
  }

  window.ColmadoAuth = window.ColmadoAuth || {};
  window.ColmadoAuth.openAuthModal = openAuthModal;

  document.addEventListener('DOMContentLoaded', () => {
    injectAuthNav();
    window.addEventListener('colmado:auth', updateAuthButton);
    refreshSession();
  });
})();
