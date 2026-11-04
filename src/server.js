require('dotenv').config();

const express = require('express');
const ExcelJS = require('exceljs');
const path = require('node:path');
const {
  AppError,
  customerInput,
  nonNegativeNumber,
  positiveNumber,
  productInput,
  reportDateBounds,
  reportDateRange,
  saleInput
} = require('./domain');
const { closePool, getPool, withTransaction } = require('./database');

const app = express();
const taxRate = Number(process.env.POS_TAX_RATE || 0);

if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
  throw new Error('POS_TAX_RATE debe ser un número entre 0 y 1.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/config', (req, res) => {
  res.json({ taxRate });
});

app.get('/api/products', async (req, res) => {
  const result = await getPool().query(`
    SELECT product_id AS "productId", sku, name, price, stock
    FROM products
    WHERE active = TRUE
    ORDER BY name;
  `);
  res.json(result.rows);
});

app.post('/api/products', async (req, res) => {
  const product = productInput(req.body);
  const result = await getPool().query(`
    INSERT INTO products (sku, name, price, stock)
    VALUES ($1, $2, $3, $4)
    RETURNING product_id AS "productId", sku, name, price, stock;
  `, [product.sku, product.name, product.price, product.stock]);
  res.status(201).json(result.rows[0]);
});

app.get('/api/customers', async (req, res) => {
  const result = await getPool().query(`
    SELECT customer_id AS "customerId", name, email, phone
    FROM customers
    WHERE active = TRUE
    ORDER BY name;
  `);
  res.json(result.rows);
});

app.post('/api/customers', async (req, res) => {
  const customer = customerInput(req.body);
  const result = await getPool().query(`
    INSERT INTO customers (name, email, phone)
    VALUES ($1, $2, $3)
    RETURNING customer_id AS "customerId", name, email, phone;
  `, [customer.name, customer.email, customer.phone]);
  res.status(201).json(result.rows[0]);
});

app.post('/api/products/:id/stock', async (req, res) => {
  const productId = positiveNumber(req.params.id, 'El identificador', 2147483647);
  const adjustment = Number(req.body.adjustment);
  if (!Number.isFinite(adjustment) || adjustment === 0 || Math.abs(adjustment) > 100000000) {
    throw new AppError(400, 'El ajuste de inventario debe ser distinto de cero y tener un valor válido.');
  }

  const stock = await withTransaction(async (client) => {
    const result = await client.query(`
      UPDATE products
      SET stock = stock + $1
      WHERE product_id = $2 AND active = TRUE AND stock + $1 >= 0
      RETURNING stock;
    `, [adjustment, productId]);
    if (!result.rows.length) {
      throw new AppError(409, 'El producto no existe o el ajuste dejaría el inventario en negativo.');
    }

    await client.query(`
      INSERT INTO inventory_movements (product_id, quantity_change, reason)
      VALUES ($1, $2, 'adjustment');
    `, [productId, adjustment]);
    return result.rows[0].stock;
  });
  res.json({ productId, stock });
});

app.get('/api/cash/status', async (req, res) => {
  const result = await getPool().query(`
    SELECT c.cash_session_id AS "cashSessionId",
      c.opening_cash AS "openingCash",
      c.opened_at AS "openedAt",
      (c.opening_cash + COALESCE(
        SUM(CASE WHEN s.payment_method = 'cash' THEN s.total ELSE 0 END), 0
      ))::NUMERIC(12,2) AS "expectedCash"
    FROM cash_sessions AS c
    LEFT JOIN sales AS s ON s.cash_session_id = c.cash_session_id
    WHERE c.status = 'open'
    GROUP BY c.cash_session_id, c.opening_cash, c.opened_at
    ORDER BY c.opened_at DESC
    LIMIT 1;
  `);
  res.json(result.rows[0] || null);
});

app.post('/api/cash/open', async (req, res) => {
  const openingCash = nonNegativeNumber(req.body.openingCash, 'El fondo inicial');
  const result = await getPool().query(`
    INSERT INTO cash_sessions (opening_cash)
    VALUES ($1)
    RETURNING cash_session_id AS "cashSessionId",
      opening_cash AS "openingCash", opened_at AS "openedAt";
  `, [openingCash]);
  res.status(201).json(result.rows[0]);
});

app.post('/api/cash/close', async (req, res) => {
  const closingCash = nonNegativeNumber(req.body.closingCash, 'El efectivo contado');
  const result = await withTransaction(async (client) => {
    const current = await client.query(`
      SELECT cash_session_id
      FROM cash_sessions
      WHERE status = 'open'
      ORDER BY opened_at DESC
      LIMIT 1
      FOR UPDATE;
    `);
    if (!current.rows.length) {
      throw new AppError(409, 'No hay una caja abierta.');
    }

    const closed = await client.query(`
      UPDATE cash_sessions
      SET status = 'closed', closing_cash = $1, closed_at = CURRENT_TIMESTAMP
      WHERE cash_session_id = $2
      RETURNING cash_session_id AS "cashSessionId",
        opening_cash AS "openingCash", closing_cash AS "closingCash",
        closed_at AS "closedAt";
    `, [closingCash, current.rows[0].cash_session_id]);
    return closed.rows[0];
  }, 'SERIALIZABLE');
  res.json(result);
});

app.post('/api/sales', async (req, res) => {
  const sale = saleInput(req.body);
  const created = await withTransaction(async (client) => {
    const cashResult = await client.query(`
      SELECT cash_session_id
      FROM cash_sessions
      WHERE status = 'open'
      ORDER BY opened_at DESC
      LIMIT 1
      FOR UPDATE;
    `);
    if (!cashResult.rows.length) {
      throw new AppError(409, 'Abre la caja antes de registrar una venta.');
    }
    const cashSessionId = cashResult.rows[0].cash_session_id;

    if (sale.customerId !== null) {
      const customerResult = await client.query(`
        SELECT customer_id
        FROM customers
        WHERE customer_id = $1 AND active = TRUE;
      `, [sale.customerId]);
      if (!customerResult.rows.length) {
        throw new AppError(404, 'El cliente no existe o está inactivo.');
      }
    }

    const items = [];
    let subtotal = 0;
    for (const item of sale.items.sort((a, b) => a.productId - b.productId)) {
      const productResult = await client.query(`
        SELECT product_id AS "productId", name, price, stock
        FROM products
        WHERE product_id = $1 AND active = TRUE
        FOR UPDATE;
      `, [item.productId]);
      const product = productResult.rows[0];
      if (!product) {
        throw new AppError(404, `El producto ${item.productId} no existe o está inactivo.`);
      }
      if (Number(product.stock) < item.quantity) {
        throw new AppError(409, `Inventario insuficiente para ${product.name}. Disponible: ${product.stock}.`);
      }

      const lineTotal = Math.round(Number(product.price) * item.quantity * 100) / 100;
      subtotal = Math.round((subtotal + lineTotal) * 100) / 100;
      items.push({ ...item, product, lineTotal });
    }

    const tax = Math.round(subtotal * taxRate * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    const saleResult = await client.query(`
      INSERT INTO sales (cash_session_id, customer_id, subtotal, tax, total, payment_method)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING sale_id AS "saleId", created_at AS "createdAt";
    `, [cashSessionId, sale.customerId, subtotal, tax, total, sale.paymentMethod]);
    const saleId = saleResult.rows[0].saleId;

    for (const item of items) {
      await client.query(`
        INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, line_total)
        VALUES ($1, $2, $3, $4, $5);
      `, [saleId, item.productId, item.quantity, item.product.price, item.lineTotal]);
      await client.query(`
        UPDATE products
        SET stock = stock - $1
        WHERE product_id = $2;
      `, [item.quantity, item.productId]);
      await client.query(`
        INSERT INTO inventory_movements (product_id, quantity_change, reason, sale_id)
        VALUES ($1, -$2, 'sale', $3);
      `, [item.productId, item.quantity, saleId]);
    }
    return {
      saleId,
      subtotal,
      tax,
      total,
      paymentMethod: sale.paymentMethod,
      createdAt: saleResult.rows[0].createdAt
    };
  }, 'SERIALIZABLE');

  res.status(201).json(created);
});

app.get('/api/sales', async (req, res) => {
  const result = await getPool().query(`
    SELECT s.sale_id AS "saleId", s.subtotal, s.tax, s.total,
      s.payment_method AS "paymentMethod", s.created_at AS "createdAt",
      c.name AS "customerName"
    FROM sales AS s
    LEFT JOIN customers AS c ON c.customer_id = s.customer_id
    ORDER BY s.created_at DESC, s.sale_id DESC
    LIMIT 20;
  `);
  res.json(result.rows);
});

app.get('/api/sales/:id', async (req, res) => {
  const saleId = positiveNumber(req.params.id, 'El identificador de venta', Number.MAX_SAFE_INTEGER);
  const [saleResult, itemResult] = await Promise.all([
    getPool().query(`
      SELECT s.sale_id AS "saleId", s.subtotal, s.tax, s.total,
        s.payment_method AS "paymentMethod", s.created_at AS "createdAt",
        c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone"
      FROM sales AS s
      LEFT JOIN customers AS c ON c.customer_id = s.customer_id
      WHERE s.sale_id = $1;
    `, [saleId]),
    getPool().query(`
      SELECT i.product_id AS "productId", p.sku, p.name, i.quantity,
        i.unit_price AS "unitPrice", i.line_total AS "lineTotal"
      FROM sale_items AS i
      INNER JOIN products AS p ON p.product_id = i.product_id
      WHERE i.sale_id = $1
      ORDER BY i.sale_item_id;
    `, [saleId])
  ]);
  if (!saleResult.rows.length) {
    throw new AppError(404, 'No se encontró la venta solicitada.');
  }
  res.json({ ...saleResult.rows[0], items: itemResult.rows });
});

async function getSalesReport(pool, range, customerId) {
  const bounds = reportDateBounds(range);
  const values = [bounds.start, bounds.end];
  let customerFilter = '';
  if (customerId) {
    values.push(customerId);
    customerFilter = `AND s.customer_id = $${values.length}`;
  }

  const result = await pool.query(`
    SELECT s.sale_id AS "saleId", s.created_at AS "createdAt",
      COALESCE(c.name, 'Público general') AS "customerName",
      s.payment_method AS "paymentMethod", s.subtotal, s.tax, s.total
    FROM sales AS s
    LEFT JOIN customers AS c ON c.customer_id = s.customer_id
    WHERE s.created_at >= $1 AND s.created_at < $2
      ${customerFilter}
    ORDER BY s.created_at DESC, s.sale_id DESC;
  `, values);
  const sales = result.rows;
  return {
    sales,
    totals: sales.reduce((totals, sale) => ({
      salesCount: totals.salesCount + 1,
      subtotal: Math.round((totals.subtotal + Number(sale.subtotal)) * 100) / 100,
      tax: Math.round((totals.tax + Number(sale.tax)) * 100) / 100,
      total: Math.round((totals.total + Number(sale.total)) * 100) / 100
    }), { salesCount: 0, subtotal: 0, tax: 0, total: 0 })
  };
}

async function getCustomerReport(pool, range, search) {
  const bounds = reportDateBounds(range);
  const values = [bounds.start, bounds.end];
  let searchFilter = '';
  if (search) {
    values.push(`%${search}%`);
    searchFilter = `AND (c.name ILIKE $${values.length} OR c.email ILIKE $${values.length} OR c.phone ILIKE $${values.length})`;
  }
  const result = await pool.query(`
    SELECT c.customer_id AS "customerId", c.name, c.email, c.phone,
      COUNT(s.sale_id)::INTEGER AS "salesCount",
      COALESCE(SUM(s.total), 0) AS "totalSpent",
      MAX(s.created_at) AS "lastPurchase"
    FROM customers AS c
    LEFT JOIN sales AS s
      ON s.customer_id = c.customer_id
      AND s.created_at >= $1
      AND s.created_at < $2
    WHERE c.active = TRUE ${searchFilter}
    GROUP BY c.customer_id, c.name, c.email, c.phone
    ORDER BY "totalSpent" DESC, c.name;
  `, values);
  const customers = result.rows;
  const totals = customers.reduce((summary, customer) => ({
    customersCount: summary.customersCount + 1,
    salesCount: summary.salesCount + Number(customer.salesCount),
    totalSpent: Math.round((summary.totalSpent + Number(customer.totalSpent)) * 100) / 100
  }), { customersCount: 0, salesCount: 0, totalSpent: 0 });
  return { customers, totals };
}

function sendExcel(res, filename, worksheetName, columns, rows, totals) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SRV POS';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(worksheetName);
  sheet.columns = columns;
  sheet.addRows(rows);
  if (totals) {
    sheet.addRow([]);
    sheet.addRow(totals);
  }
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF245C45' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return workbook.xlsx.writeBuffer().then((buffer) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  });
}

app.get('/api/reports/sales', async (req, res) => {
  const range = reportDateRange(req.query);
  const customerId = req.query.customerId
    ? positiveNumber(req.query.customerId, 'El identificador de cliente', 2147483647)
    : null;
  const report = await getSalesReport(getPool(), range, customerId);
  res.json({ ...range, ...report });
});

app.get('/api/reports/sales/export.xlsx', async (req, res) => {
  const range = reportDateRange(req.query);
  const customerId = req.query.customerId
    ? positiveNumber(req.query.customerId, 'El identificador de cliente', 2147483647)
    : null;
  const report = await getSalesReport(getPool(), range, customerId);
  const rows = report.sales.map((sale) => [
    sale.saleId, sale.createdAt, sale.customerName, sale.paymentMethod,
    Number(sale.subtotal), Number(sale.tax), Number(sale.total)
  ]);
  return sendExcel(res, 'reporte-ventas.xlsx', 'Ventas', [
    { header: 'Venta', key: 'saleId', width: 14 },
    { header: 'Fecha', key: 'createdAt', width: 22 },
    { header: 'Cliente', key: 'customerName', width: 28 },
    { header: 'Pago', key: 'paymentMethod', width: 18 },
    { header: 'Subtotal', key: 'subtotal', width: 16, style: { numFmt: '$#,##0.00' } },
    { header: 'Impuestos', key: 'tax', width: 16, style: { numFmt: '$#,##0.00' } },
    { header: 'Total', key: 'total', width: 16, style: { numFmt: '$#,##0.00' } }
  ], rows, ['Totales', '', '', '', report.totals.subtotal, report.totals.tax, report.totals.total]);
});

app.get('/api/reports/customers', async (req, res) => {
  const range = reportDateRange(req.query);
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 150) : '';
  res.json({ ...range, ...await getCustomerReport(getPool(), range, search) });
});

app.get('/api/reports/customers/export.xlsx', async (req, res) => {
  const range = reportDateRange(req.query);
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 150) : '';
  const report = await getCustomerReport(getPool(), range, search);
  const rows = report.customers.map((customer) => [
    customer.customerId, customer.name, customer.email || '', customer.phone || '',
    Number(customer.salesCount), Number(customer.totalSpent), customer.lastPurchase || ''
  ]);
  return sendExcel(res, 'reporte-clientes.xlsx', 'Clientes', [
    { header: 'Cliente', key: 'customerId', width: 14 },
    { header: 'Nombre', key: 'name', width: 28 },
    { header: 'Correo', key: 'email', width: 32 },
    { header: 'Teléfono', key: 'phone', width: 20 },
    { header: 'Ventas', key: 'salesCount', width: 14 },
    { header: 'Total comprado', key: 'totalSpent', width: 20, style: { numFmt: '$#,##0.00' } },
    { header: 'Última compra', key: 'lastPurchase', width: 22 }
  ], rows, ['Totales', '', '', '', report.totals.salesCount, report.totals.totalSpent, '']);
});

app.get('/api/summary', async (req, res) => {
  const today = new Date();
  const todayString = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('-');
  const bounds = reportDateBounds({ from: todayString, to: todayString });
  const result = await getPool().query(`
    SELECT COUNT(*)::INTEGER AS "salesToday",
      COALESCE(SUM(total), 0) AS "totalToday"
    FROM sales
    WHERE created_at >= $1 AND created_at < $2;
  `, [bounds.start, bounds.end]);
  res.json(result.rows[0]);
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Recurso no encontrado.' });
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof AppError) {
    return res.status(error.status).json({ error: error.message });
  }
  if (error.code === '23505' && error.constraint === 'products_sku_key') {
    return res.status(409).json({ error: 'Ya existe un producto con ese código.' });
  }
  if (error.code === '23505' && error.constraint === 'ux_cash_sessions_open') {
    return res.status(409).json({ error: 'Ya existe una caja abierta.' });
  }
  if (error.code === '40001') {
    return res.status(409).json({ error: 'La operación entró en conflicto con otra. Vuelve a intentarlo.' });
  }
  if (error.type === 'entity.too.large' || error.status === 413) {
    return res.status(413).json({ error: 'La solicitud excede el tamaño permitido.' });
  }

  console.error('Error en la solicitud:', error);
  return res.status(500).json({ error: 'Ocurrió un error interno. Revisa la consola del servidor.' });
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

async function start() {
  await getPool().query('SELECT 1');
  const server = app.listen(port, host, () => {
    console.log(`POS disponible en http://${host}:${port}`);
  });

  const shutdown = () => {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  start().catch(async (error) => {
    console.error(`No se pudo iniciar el POS con PostgreSQL: ${error.message}`);
    await closePool();
    process.exitCode = 1;
  });
}

module.exports = { app, sendExcel };
