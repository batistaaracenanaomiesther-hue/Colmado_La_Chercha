const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { pool, initSchema, slugify } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'colmado-customer-jwt-dev';

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plain, stored) {
  const parts = String(stored).split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  try {
    const h = crypto.scryptSync(plain, salt, 64).toString('hex');
    return h === hash;
  } catch {
    return false;
  }
}

function signUserToken(userId, email) {
  const payload = {
    uid: userId,
    email,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyUserToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'LaChercha2026';
const ADMIN_KEY = process.env.ADMIN_KEY || 'colmado2026';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

function adminAuth(req, res, next) {
  const u = String(req.headers['x-admin-user'] || '').trim();
  const p = String(req.headers['x-admin-password'] || '');
  const k = req.headers['x-admin-key'];
  
  if ((u === ADMIN_USER && p === ADMIN_PASSWORD) || k === ADMIN_KEY) {
    return next();
  }
  
  console.log(`[AdminAuth] Intento fallido. Usuario: ${u}, Password: ${p ? '****' : 'vacío'}, Key: ${k ? 'presente' : 'ausente'}`);
  return res.status(401).json({ error: 'Credenciales de administrador inválidas' });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: 'mysql', host: process.env.DB_HOST || '127.0.0.1' });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, phone, role } = req.body || {};
  const em = email && String(email).trim().toLowerCase();
  const nm = name && String(name).trim();
  const pw = password && String(password);
  if (!em || !pw || !nm) {
    return res.status(400).json({ error: 'Nombre, correo y contraseña son obligatorios' });
  }
  if (pw.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(em)) {
    return res.status(400).json({ error: 'Correo no válido' });
  }
  const validRoles = new Set(['admin', 'empleado', 'usuario']);
  const nextRole = validRoles.has(role) ? role : 'usuario';
  try {
    const [exists] = await pool.execute('SELECT id FROM users WHERE LOWER(email) = ?', [em]);
    if (exists.length) {
      return res.status(409).json({ error: 'Este correo ya está registrado' });
    }
    const ph = hashPassword(pw);
    const [r] = await pool.execute(
      'INSERT INTO users (email, password_hash, name, phone, role) VALUES (?, ?, ?, ?, ?)',
      [em, ph, nm, phone ? String(phone).trim() : null, nextRole]
    );
    const [rows] = await pool.execute('SELECT id, name, email, phone, role FROM users WHERE id = ?', [
      r.insertId,
    ]);
    const row = rows[0];
    const token = signUserToken(row.id, row.email);
    res.status(201).json({ token, user: row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo registrar' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const em = email && String(email).trim().toLowerCase();
  const pw = password && String(password);
  if (!em || !pw) {
    return res.status(400).json({ error: 'Correo y contraseña requeridos' });
  }
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE LOWER(email) = ?', [em]);
    const row = rows[0];
    if (!row || !verifyPassword(pw, row.password_hash)) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    }
    const user = {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
    };
    res.json({ token: signUserToken(row.id, row.email), user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: 'No autorizado' });
  const payload = verifyUserToken(m[1].trim());
  if (!payload) return res.status(401).json({ error: 'Sesión inválida o expirada' });
  try {
    const [rows] = await pool.execute('SELECT id, name, email, phone, role FROM users WHERE id = ?', [
      payload.uid,
    ]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(row);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, slug, name, emoji FROM categories ORDER BY id');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/products', async (req, res) => {
  const activeOnly = req.query.all !== '1';
  const sql = `
    SELECT p.id, p.name, p.slug, p.price, p.image, p.stock, p.active,
           c.slug AS category_slug, c.name AS category_name, c.emoji AS category_emoji
    FROM products p
    JOIN categories c ON c.id = p.category_id
    ${activeOnly ? 'WHERE p.active = 1' : ''}
    ORDER BY c.id, p.name
  `;
  try {
    const [rows] = await pool.query(sql);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.*, c.slug AS category_slug, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

app.post('/api/contact', async (req, res) => {
  const { nombre, correo, telefono, mensaje } = req.body || {};
  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'Nombre requerido' });
  }
  if (!mensaje || !String(mensaje).trim()) {
    return res.status(400).json({ error: 'Mensaje requerido' });
  }
  try {
    const [r] = await pool.execute(
      'INSERT INTO mensajes (nombre, correo, telefono, mensaje) VALUES (?, ?, ?, ?)',
      [
        String(nombre).trim(),
        correo ? String(correo).trim() : null,
        telefono ? String(telefono).trim() : null,
        String(mensaje).trim(),
      ]
    );
    res.status(201).json({ id: r.insertId, ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo guardar el mensaje' });
  }
});

app.get('/api/messages', adminAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, fecha AS created_at, nombre, correo, telefono, mensaje
       FROM mensajes ORDER BY fecha DESC LIMIT 100`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { customer_name, customer_phone, customer_email, notes, items } = req.body || {};
  if (!customer_name || !String(customer_name).trim()) {
    return res.status(400).json({ error: 'Nombre requerido' });
  }
  if (!customer_phone || !String(customer_phone).trim()) {
    return res.status(400).json({ error: 'Teléfono requerido' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'El pedido debe incluir productos' });
  }

  let total = 0;
  const normalized = [];
  for (const it of items) {
    const pid = Number(it.product_id);
    const qty = Math.max(1, Math.min(999, parseInt(it.quantity, 10) || 1));
    if (!pid) continue;
    const [prows] = await pool.execute(
      'SELECT id, name, price, stock, active FROM products WHERE id = ?',
      [pid]
    );
    const p = prows[0];
    if (!p || !p.active) continue;
    if (p.stock < qty) {
      return res.status(400).json({ error: `Stock insuficiente: ${p.name}` });
    }
    const line = Number(p.price) * qty;
    total += line;
    normalized.push({ ...p, quantity: qty });
  }

  if (normalized.length === 0) {
    return res.status(400).json({ error: 'No hay líneas válidas' });
  }

  let authUserId = null;
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const payload = verifyUserToken(m[1].trim());
    if (payload && payload.uid) authUserId = Number(payload.uid) || null;
  }
  const roundedTotal = Math.round(total * 100) / 100;
  if (roundedTotal > 5000 && !authUserId) {
    return res.status(401).json({
      error: 'Para pedidos mayores a RD$5,000 debes iniciar sesión antes de continuar',
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.execute(
      `INSERT INTO orders (user_id, customer_name, customer_phone, customer_email, notes, status, total)
       VALUES (?, ?, ?, ?, ?, 'pendiente', ?)`,
      [
        authUserId,
        String(customer_name).trim(),
        String(customer_phone).trim(),
        customer_email ? String(customer_email).trim() : null,
        notes ? String(notes).trim() : null,
        roundedTotal,
      ]
    );
    const orderId = ins.insertId;
    for (const line of normalized) {
      await conn.execute(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, line.id, line.name, line.price, line.quantity]
      );
      await conn.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [
        line.quantity,
        line.id,
      ]);
    }
    await conn.commit();
    res.status(201).json({ id: orderId, total: roundedTotal });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear el pedido' });
  } finally {
    conn.release();
  }
});

app.get('/api/dashboard/stats', adminAuth, async (req, res) => {
  try {
    const [todayRow] = await pool.query(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
       FROM orders WHERE DATE(created_at) = CURDATE()`
    );
    const today = todayRow[0];
    const [pendingRow] = await pool.query(
      `SELECT COUNT(*) AS n FROM orders WHERE status = 'pendiente'`
    );
    const [productsRow] = await pool.query(
      `SELECT COUNT(*) AS n FROM products WHERE active = 1`
    );
    const [lowRow] = await pool.query(
      `SELECT COUNT(*) AS n FROM products WHERE active = 1 AND stock < 20`
    );
    const [msgRow] = await pool.query(`SELECT COUNT(*) AS n FROM mensajes`);
    res.json({
      ordersToday: today.orders,
      revenueToday: Number(today.revenue),
      pendingOrders: pendingRow[0].n,
      activeProducts: productsRow[0].n,
      lowStock: lowRow[0].n,
      contactMessages: msgRow[0].n,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/orders', adminAuth, async (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  try {
    const [rows] = await pool.query(
      `SELECT
         o.id,
         o.created_at,
         o.customer_name,
         o.customer_phone,
         o.customer_email,
         o.notes,
         o.status,
         o.total,
         o.user_id,
         u.name AS user_name,
         u.email AS user_email,
         u.role AS user_role
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC
       LIMIT ?`,
      [limit]
    );
    console.log(`[API] Se recuperaron ${rows.length} pedidos.`);
    res.json(rows);
  } catch (e) {
    console.error('[API Error] Error en /api/orders:', e);
    res.status(500).json({ error: 'Error al obtener pedidos de la base de datos' });
  }
}

app.patch('/api/users/:id/role', adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { role } = req.body || {};
  const allowed = new Set(['admin', 'empleado', 'usuario']);
  if (!id) return res.status(400).json({ error: 'ID inválido' });
  if (!allowed.has(role)) {
    return res.status(400).json({ error: 'Rol inválido' });
  }
  try {
    const [curRows] = await pool.execute('SELECT id, role FROM users WHERE id = ?', [id]);
    const current = curRows[0];
    if (!current) return res.status(404).json({ error: 'Usuario no encontrado' });
    await pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    res.json({ ok: true, id, role });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo actualizar el rol' });
  }
});

app.get('/api/dashboard/users-orders', adminAuth, async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.role,
        u.created_at,
        COUNT(o.id) AS orders_count,
        COALESCE(SUM(o.total), 0) AS orders_total,
        MAX(o.created_at) AS last_order_at
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      GROUP BY u.id, u.name, u.email, u.phone, u.role, u.created_at
      ORDER BY u.created_at DESC
      LIMIT 500`
    );
    const [recentOrders] = await pool.query(
      `SELECT
        o.id,
        o.user_id,
        o.created_at,
        o.status,
        o.total,
        o.customer_name,
        u.name AS user_name,
        u.email AS user_email,
        u.role AS user_role
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      WHERE o.user_id IS NOT NULL
      ORDER BY o.created_at DESC
      LIMIT 300`
    );
    res.json({
      users: users.map((u) => ({
        ...u,
        orders_count: Number(u.orders_count),
        orders_total: Number(u.orders_total),
      })),
      recentOrders,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/orders/:id', adminAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    const [items] = await pool.execute(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY id',
      [req.params.id]
    );
    res.json({ ...rows[0], items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

app.patch('/api/orders/:id/status', adminAuth, async (req, res) => {
  const allowed = ['pendiente', 'preparando', 'listo', 'entregado', 'cancelado'];
  const { status } = req.body || {};
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  try {
    const [r] = await pool.execute('UPDATE orders SET status = ? WHERE id = ?', [
      status,
      req.params.id,
    ]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

app.patch('/api/products/:id', adminAuth, async (req, res) => {
  const id = req.params.id;
  const { price, stock, active, name } = req.body || {};
  try {
    const [curRows] = await pool.execute('SELECT * FROM products WHERE id = ?', [id]);
    const cur = curRows[0];
    if (!cur) return res.status(404).json({ error: 'No encontrado' });

    const nextPrice = price != null ? Number(price) : cur.price;
    const nextStock = stock != null ? parseInt(stock, 10) : cur.stock;
    const nextActive = active != null ? (active ? 1 : 0) : cur.active;
    const nextName = name != null ? String(name).trim() : cur.name;

    if (Number.isNaN(nextPrice) || nextPrice < 0) {
      return res.status(400).json({ error: 'Precio inválido' });
    }
    if (Number.isNaN(nextStock) || nextStock < 0) {
      return res.status(400).json({ error: 'Stock inválido' });
    }

    let nextSlug = cur.slug;
    if (name != null && nextName !== cur.name) {
      nextSlug = slugify(nextName);
      const [clash] = await pool.execute('SELECT id FROM products WHERE slug = ? AND id != ?', [
        nextSlug,
        id,
      ]);
      if (clash.length) nextSlug = `${nextSlug}-${id}`;
    }

    await pool.execute(
      'UPDATE products SET name = ?, slug = ?, price = ?, stock = ?, active = ? WHERE id = ?',
      [nextName, nextSlug, nextPrice, nextStock, nextActive, id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error' });
  }
});

const publicRoot = path.join(__dirname, '..');
app.use(express.static(publicRoot));

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  res.status(404).send('No encontrado');
});

async function start() {
  await initSchema();
  const { runSeed } = require('./seed');
  await runSeed(false);
  app.listen(PORT, () => {
    console.log(`Colmado La Chercha → http://localhost:${PORT}`);
    console.log(`Base de datos MySQL (XAMPP): ${process.env.DB_NAME || 'colmado_la_chercha'}`);
    console.log(`Dashboard → http://localhost:${PORT}/dashboard.html`);
    console.log(`  Admin usuario: ${ADMIN_USER}  |  contraseña: ${ADMIN_PASSWORD}`);
    console.log(`  (Opcional API key: ADMIN_KEY=${ADMIN_KEY})`);
  });
}

start().catch((err) => {
  console.error('No se pudo iniciar:', err.message);
  process.exit(1);
});
