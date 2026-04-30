const { pool, initSchema, slugify } = require('./db');
const { categories: catRows, products: prodRows } = require('./seed-data');

async function runSeed(force = false) {
  await initSchema();
  await pool.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');

  if (!force) {
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM products');
    if (rows[0].n > 0) {
      console.log('BD ya tiene productos, omitiendo seed (usa node seed.js --force para resembrar)');
      return;
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (force) {
      await conn.query('SET FOREIGN_KEY_CHECKS=0');
      await conn.query('TRUNCATE TABLE order_items');
      await conn.query('TRUNCATE TABLE orders');
      await conn.query('TRUNCATE TABLE products');
      await conn.query('TRUNCATE TABLE categories');
      await conn.query('SET FOREIGN_KEY_CHECKS=1');
    }

    const idByKey = {};
    for (const c of catRows) {
      await conn.query(
        'INSERT IGNORE INTO categories (slug, name, emoji) VALUES (?, ?, ?)',
        [c.key, c.name, c.emoji]
      );
      const [r] = await conn.query('SELECT id FROM categories WHERE slug = ?', [c.key]);
      idByKey[c.key] = r[0].id;
    }

    const usedSlugs = new Set();
    for (const [catKey, name, price, image] of prodRows) {
      let base = slugify(name);
      let slug = base;
      let n = 2;
      while (usedSlugs.has(slug)) {
        slug = `${base}-${n++}`;
      }
      usedSlugs.add(slug);
      await conn.query(
        `INSERT INTO products (category_id, name, slug, price, image, stock, active)
         VALUES (?, ?, ?, ?, ?, 500, 1)`,
        [idByKey[catKey], name, slug, price, image]
      );
    }

    await conn.commit();
    const [c] = await pool.query('SELECT COUNT(*) AS n FROM products');
    console.log('Seed OK:', c[0].n, 'productos');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  runSeed(force).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runSeed };
