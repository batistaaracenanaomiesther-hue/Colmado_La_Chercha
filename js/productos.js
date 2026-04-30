(function () {
  const root = document.getElementById('productos-root');
  const errEl = document.getElementById('productos-error');

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function groupByCategory(products) {
    const map = new Map();
    for (const p of products) {
      const key = p.category_slug;
      if (!map.has(key)) {
        map.set(key, {
          name: p.category_name,
          emoji: p.category_emoji || '',
          items: [],
        });
      }
      map.get(key).items.push(p);
    }
    return map;
  }

  async function load() {
    if (!root) return;
    root.innerHTML = '<div class="loading-shimmer" style="min-height:200px"></div>';
    try {
      const products = await Colmado.api('/api/products');
      if (!products.length) {
        root.innerHTML = '<p class="vacio">No hay productos disponibles.</p>';
        return;
      }
      const groups = groupByCategory(products);
      root.innerHTML = '';
      let delay = 0;
      for (const [, g] of groups) {
        const section = document.createElement('section');
        section.className = 'categoria';
        section.style.animationDelay = delay + 'ms';
        delay += 40;
        section.innerHTML = `<h2>${esc(g.emoji + ' ' + g.name)}</h2><div class="productos"></div>`;
        const grid = section.querySelector('.productos');
        for (const p of g.items) {
          const card = document.createElement('article');
          card.className = 'producto';
          card.innerHTML = `
            <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">
            <h3>${esc(p.name)}</h3>
            <p class="precio-tag">${Colmado.formatMoney(p.price)}</p>
            <button type="button" data-add="${p.id}">Agregar</button>
          `;
          grid.appendChild(card);
        }
        root.appendChild(section);
      }

      root.querySelectorAll('[data-add]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.getAttribute('data-add'));
          const p = products.find((x) => x.id === id);
          if (!p) return;
          Colmado.addToCart({
            product_id: p.id,
            nombre: p.name,
            precio: p.price,
            imagen: p.image,
          });
        });
      });
    } catch (e) {
      if (errEl) {
        errEl.style.display = 'block';
        errEl.className = 'err-banner';
        errEl.textContent =
          'No se pudo cargar el catálogo. Ejecuta el servidor (en carpeta server: npm start) y abre http://localhost:3000';
      }
      root.innerHTML =
        '<p class="vacio">Abre la tienda desde el servidor Node para ver productos en vivo.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
