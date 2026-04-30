(function () {
  const STORAGE_KEY = 'colmado_cart_v2';
  const USER_TOKEN_KEY = 'colmado_user_token';
  const USER_PROFILE_KEY = 'colmado_user_profile';

  function migrateLegacyCart() {
    if (localStorage.getItem(STORAGE_KEY)) return;
    try {
      const old = JSON.parse(localStorage.getItem('carrito') || 'null');
      if (!Array.isArray(old) || !old.length) return;
      const mapped = old.map((x) => ({
        product_id: Number(x.product_id || x.id) || 0,
        nombre: x.nombre || x.name || 'Producto',
        precio: Number(x.precio ?? x.price ?? 0),
        imagen: x.imagen || x.image || '',
        cantidad: Math.max(1, parseInt(x.cantidad || x.quantity, 10) || 1),
      })).filter((x) => x.product_id);
      if (mapped.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(mapped));
    } catch (_) {}
  }

  function getUserToken() {
    return localStorage.getItem(USER_TOKEN_KEY) || '';
  }

  function getUserProfile() {
    try {
      const raw = localStorage.getItem(USER_PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setUserSession(token, user) {
    if (token) localStorage.setItem(USER_TOKEN_KEY, token);
    else localStorage.removeItem(USER_TOKEN_KEY);
    if (user) localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_PROFILE_KEY);
    window.dispatchEvent(new CustomEvent('colmado:auth'));
  }

  function clearUserSession() {
    localStorage.removeItem(USER_TOKEN_KEY);
    localStorage.removeItem(USER_PROFILE_KEY);
    window.dispatchEvent(new CustomEvent('colmado:auth'));
  }

  function api(path, opts) {
    const base = '';
    const headers = { 'Content-Type': 'application/json', ...(opts && opts.headers) };
    const t = getUserToken();
    if (t && !headers.Authorization) headers.Authorization = 'Bearer ' + t;
    return fetch(base + path, {
      ...opts,
      headers,
    }).then((r) => {
      if (!r.ok) {
        return r.json().then((j) => {
          throw new Error(j.error || r.statusText);
        });
      }
      return r.json();
    });
  }

  function normalizeItem(raw) {
    const product_id = Number(raw.product_id || raw.id);
    const nombre = raw.nombre || raw.name || 'Producto';
    const precio = Number(raw.precio ?? raw.price ?? 0);
    const imagen = raw.imagen || raw.image || '';
    const cantidad = Math.max(1, parseInt(raw.cantidad || raw.quantity, 10) || 1);
    return { product_id, nombre, precio, imagen, cantidad };
  }

  function getCart() {
    migrateLegacyCart();
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.map(normalizeItem).filter((x) => x.product_id);
    } catch {
      return [];
    }
  }

  function setCart(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('colmado:cart'));
  }

  function cartCount() {
    return getCart().reduce((a, x) => a + x.cantidad, 0);
  }

  function cartTotal() {
    return getCart().reduce((a, x) => a + x.precio * x.cantidad, 0);
  }

  function addToCart(product) {
    const p = normalizeItem({ ...product, cantidad: 1 });
    const cart = getCart();
    const i = cart.findIndex((x) => x.product_id === p.product_id);
    if (i >= 0) cart[i].cantidad += 1;
    else cart.push({ ...p, cantidad: 1 });
    setCart(cart);
    showToast(`"${p.nombre}" añadido al carrito`, 'ok');
    updateCartChrome();
  }

  function updateQty(product_id, delta) {
    const cart = getCart();
    const i = cart.findIndex((x) => x.product_id === product_id);
    if (i < 0) return;
    cart[i].cantidad += delta;
    if (cart[i].cantidad < 1) cart.splice(i, 1);
    setCart(cart);
    updateCartChrome();
  }

  function removeLine(product_id) {
    setCart(getCart().filter((x) => x.product_id !== product_id));
    updateCartChrome();
  }

  function clearCart() {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('colmado:cart'));
    updateCartChrome();
  }

  function formatMoney(n) {
    const v = Number(n) || 0;
    return (
      'RD$' +
      v.toLocaleString('es-DO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function showToast(message, type) {
    let el = document.getElementById('colmado-toast-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'colmado-toast-root';
      el.className = 'toast-host';
      document.body.appendChild(el);
    }
    const t = document.createElement('div');
    t.className = 'toast toast--' + (type || 'info');
    t.textContent = message;
    el.appendChild(t);
    requestAnimationFrame(() => t.classList.add('toast--in'));
    setTimeout(() => {
      t.classList.remove('toast--in');
      t.classList.add('toast--out');
      setTimeout(() => t.remove(), 320);
    }, 3200);
  }

  function ensureDrawer() {
    if (document.getElementById('cart-drawer')) return;
    const backdrop = document.createElement('div');
    backdrop.id = 'cart-backdrop';
    backdrop.className = 'drawer-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const drawer = document.createElement('aside');
    drawer.id = 'cart-drawer';
    drawer.className = 'cart-drawer';
    drawer.setAttribute('aria-label', 'Carrito de compras');
    drawer.innerHTML = `
      <div class="cart-drawer__head">
        <h2>Tu carrito</h2>
        <button type="button" class="icon-btn cart-drawer__close" aria-label="Cerrar">✕</button>
      </div>
      <div class="cart-drawer__body" id="cart-drawer-body"></div>
      <div class="cart-drawer__foot">
        <div class="cart-drawer__total"><span>Total</span><strong id="cart-drawer-total">RD$0.00</strong></div>
        <a class="btn btn--primary btn--block" href="carrito.html">Ver carrito y pedir</a>
      </div>
    `;
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    backdrop.addEventListener('click', closeDrawer);
    drawer.querySelector('.cart-drawer__close').addEventListener('click', closeDrawer);
  }

  function renderDrawerBody() {
    const body = document.getElementById('cart-drawer-body');
    const totalEl = document.getElementById('cart-drawer-total');
    if (!body) return;
    const cart = getCart();
    if (cart.length === 0) {
      body.innerHTML = '<p class="cart-empty">Aún no hay productos. ¡Explora el catálogo!</p>';
      if (totalEl) totalEl.textContent = formatMoney(0);
      return;
    }
    body.innerHTML = '';
    cart.forEach((line) => {
      const row = document.createElement('div');
      row.className = 'cart-line';
      row.innerHTML = `
        <img src="${line.imagen}" alt="" class="cart-line__img" loading="lazy">
        <div class="cart-line__info">
          <div class="cart-line__name">${escapeHtml(line.nombre)}</div>
          <div class="cart-line__price">${formatMoney(line.precio)} c/u</div>
          <div class="cart-line__qty">
            <button type="button" data-act="minus" data-id="${line.product_id}" aria-label="Menos">−</button>
            <span>${line.cantidad}</span>
            <button type="button" data-act="plus" data-id="${line.product_id}" aria-label="Más">+</button>
          </div>
        </div>
      `;
      body.appendChild(row);
    });
    body.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-id'));
        const act = btn.getAttribute('data-act');
        updateQty(id, act === 'plus' ? 1 : -1);
        renderDrawerBody();
      });
    });
    if (totalEl) totalEl.textContent = formatMoney(cartTotal());
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function openDrawer() {
    ensureDrawer();
    renderDrawerBody();
    document.getElementById('cart-backdrop').classList.add('is-open');
    document.getElementById('cart-drawer').classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    const b = document.getElementById('cart-backdrop');
    const d = document.getElementById('cart-drawer');
    if (b) b.classList.remove('is-open');
    if (d) d.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  function updateCartChrome() {
    const badges = document.querySelectorAll('[data-cart-count]');
    const n = cartCount();
    badges.forEach((el) => {
      el.textContent = n > 99 ? '99+' : String(n);
      el.classList.toggle('is-hidden', n === 0);
    });
    if (document.getElementById('cart-drawer-body')) renderDrawerBody();
  }

  function initHeaderInteractions() {
    document.querySelectorAll('[data-open-cart]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openDrawer();
      });
    });
  }

  window.Colmado = {
    api,
    getUserToken,
    getUserProfile,
    setUserSession,
    clearUserSession,
    getCart,
    setCart,
    addToCart,
    updateQty,
    removeLine,
    clearCart,
    cartCount,
    cartTotal,
    formatMoney,
    showToast,
    openDrawer,
    closeDrawer,
    updateCartChrome,
    initHeaderInteractions,
  };

  document.addEventListener('DOMContentLoaded', () => {
    ensureDrawer();
    initHeaderInteractions();
    updateCartChrome();
    window.addEventListener('colmado:cart', updateCartChrome);
  });
})();
