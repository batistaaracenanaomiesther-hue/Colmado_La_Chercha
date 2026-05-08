require('dotenv').config();
const mysql = require('mysql2/promise');

function normalizeCert(raw) {
  if (!raw) return '';
  return String(raw).replace(/\\n/g, '\n').trim();
}

function parseDbConfig() {
  const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL || '';
  const hasUrl = typeof databaseUrl === 'string' && databaseUrl.trim().length > 0;
  const base = {
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    charset: 'utf8mb4',
  };

  if (!hasUrl) {
    const cfg = {
      ...base,
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : '',
      database: process.env.DB_NAME || 'colmado_la_chercha',
    };
    const sslMode = String(process.env.DB_SSL_MODE || '').toUpperCase();
    const sslCa = normalizeCert(process.env.DB_SSL_CA);
    if (sslMode === 'REQUIRED') {
      cfg.ssl = sslCa ? { ca: sslCa, rejectUnauthorized: true } : { rejectUnauthorized: true };
    }
    return cfg;
  }

  const url = new URL(databaseUrl.trim());
  const dbName = url.pathname.replace(/^\//, '') || 'defaultdb';
  const sslMode = String(url.searchParams.get('ssl-mode') || process.env.DB_SSL_MODE || '').toUpperCase();
  const sslCa = normalizeCert(process.env.DB_SSL_CA);
  const cfg = {
    ...base,
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    database: dbName,
  };
  if (sslMode === 'REQUIRED') {
    cfg.ssl = sslCa ? { ca: sslCa, rejectUnauthorized: true } : { rejectUnauthorized: true };
  }
  return cfg;
}

const pool = mysql.createPool(parseDbConfig());

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(128) NOT NULL,
      emoji VARCHAR(16) DEFAULT ''
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NOT NULL UNIQUE,
      price DECIMAL(10,2) NOT NULL,
      image VARCHAR(512) NOT NULL,
      stock INT NOT NULL DEFAULT 500,
      active TINYINT(1) NOT NULL DEFAULT 1,
      CONSTRAINT fk_products_cat FOREIGN KEY (category_id) REFERENCES categories(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(512) NOT NULL,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(64),
      role ENUM('admin','empleado','usuario') NOT NULL DEFAULT 'usuario',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      customer_name VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(64) NOT NULL,
      customer_email VARCHAR(255),
      notes TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'pendiente',
      total DECIMAL(12,2) NOT NULL,
      INDEX idx_orders_user_id (user_id),
      CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT,
      product_name VARCHAR(255) NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL,
      quantity INT NOT NULL,
      CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_oi_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  /** Tabla de mensajes usada por la web actual */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mensajes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      nombre VARCHAR(255) NOT NULL,
      correo VARCHAR(255),
      telefono VARCHAR(64),
      mensaje TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Migraciones ligeras para bases ya existentes.
  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM users LIKE 'role'");
    if (rows.length === 0) {
      await pool.query("ALTER TABLE users ADD COLUMN role ENUM('admin','empleado','usuario') NOT NULL DEFAULT 'usuario'");
    }
  } catch (err) {
    console.error('Error adding role column:', err);
  }

  try {
    const [rows] = await pool.query("SHOW COLUMNS FROM orders LIKE 'user_id'");
    if (rows.length === 0) {
      await pool.query("ALTER TABLE orders ADD COLUMN user_id INT NULL");
    }
  } catch (err) {
    console.error('Error adding user_id column:', err);
  }
  const [idxRows] = await pool.execute(
    `SELECT COUNT(*) AS n
     FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'orders' AND index_name = 'idx_orders_user_id'`
  );
  if (!idxRows[0].n) {
    await pool.query('ALTER TABLE orders ADD INDEX idx_orders_user_id (user_id)');
  }
  const [fkRows] = await pool.execute(
    `SELECT COUNT(*) AS n
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE() AND table_name = 'orders' AND constraint_name = 'fk_orders_user' AND constraint_type = 'FOREIGN KEY'`
  );
  if (!fkRows[0].n) {
    await pool.query(
      'ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL'
    );
  }
}

function slugify(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

module.exports = { pool, initSchema, slugify };
