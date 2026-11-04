const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const quantityFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 });
const state = { products: [], customers: [], cart: new Map(), cash: null, taxRate: 0 };

const elements = {
  connectionIndicator: document.querySelector('#connection-indicator'),
  connectionLabel: document.querySelector('#connection-label'),
  cashAction: document.querySelector('#cash-action'),
  todayLabel: document.querySelector('#today-label'),
  todaySales: document.querySelector('#today-sales'),
  salesCount: document.querySelector('#sales-count'),
  notice: document.querySelector('#notice'),
  products: document.querySelector('#products'),
  search: document.querySelector('#product-search'),
  cartItems: document.querySelector('#cart-items'),
  cartCount: document.querySelector('#cart-count'),
  subtotal: document.querySelector('#cart-subtotal'),
  tax: document.querySelector('#cart-tax'),
  total: document.querySelector('#cart-total'),
  paymentMethod: document.querySelector('#payment-method'),
  saleCustomer: document.querySelector('#sale-customer'),
  checkout: document.querySelector('#checkout'),
  salesList: document.querySelector('#sales-list'),
  productDialog: document.querySelector('#product-dialog'),
  productForm: document.querySelector('#product-form'),
  stockDialog: document.querySelector('#stock-dialog'),
  stockForm: document.querySelector('#stock-form'),
  cashDialog: document.querySelector('#cash-dialog'),
  cashForm: document.querySelector('#cash-form'),
  customerDialog: document.querySelector('#customer-dialog'),
  customerForm: document.querySelector('#customer-form'),
  ticketDialog: document.querySelector('#ticket-dialog'),
  ticketContent: document.querySelector('#ticket-content')
};

function formatCurrency(value) {
  return currency.format(Number(value) || 0);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'No se pudo completar la solicitud.');
  }
  return data;
}

function showNotice(message, isError = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle('error', isError);
  elements.notice.hidden = false;
  window.clearTimeout(showNotice.timeout);
  showNotice.timeout = window.setTimeout(() => { elements.notice.hidden = true; }, 5000);
}

function setConnection(connected) {
  elements.connectionIndicator.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  elements.connectionLabel.textContent = connected ? 'Conectado a PostgreSQL' : 'Sin conexión';
}

function renderProducts() {
  const search = elements.search.value.trim().toLocaleLowerCase('es-MX');
  const products = state.products.filter((product) =>
    `${product.name} ${product.sku}`.toLocaleLowerCase('es-MX').includes(search)
  );
  elements.products.replaceChildren();

  if (!products.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = state.products.length ? 'No hay productos que coincidan con la búsqueda.' : 'Agrega tu primer producto para comenzar.';
    elements.products.append(empty);
    return;
  }

  for (const product of products) {
    const card = document.createElement('article');
    card.className = 'product-card';
    const top = document.createElement('div');
    top.className = 'product-top';
    const title = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'product-name';
    name.textContent = product.name;
    const sku = document.createElement('span');
    sku.className = 'product-sku';
    sku.textContent = product.sku;
    title.append(name, sku);

    const stock = document.createElement('span');
    stock.className = `stock-badge${Number(product.stock) < 5 ? ' low' : ''}`;
    stock.textContent = `Exist. ${quantityFormat.format(product.stock)}`;
    top.append(title, stock);

    const bottom = document.createElement('div');
    bottom.className = 'product-bottom';
    const price = document.createElement('span');
    price.className = 'product-price';
    price.textContent = formatCurrency(product.price);
    const actions = document.createElement('div');
    actions.className = 'product-actions';
    const adjust = document.createElement('button');
    adjust.className = 'stock-adjust-button';
    adjust.type = 'button';
    adjust.textContent = '±';
    adjust.title = 'Ajustar existencia';
    adjust.setAttribute('aria-label', `Ajustar existencia de ${product.name}`);
    adjust.addEventListener('click', () => {
      document.querySelector('#stock-help').textContent =
        `${product.name} · Existencia actual: ${quantityFormat.format(product.stock)}`;
      elements.stockForm.dataset.productId = product.productId;
      elements.stockForm.elements.adjustment.value = '';
      elements.stockDialog.showModal();
    });
    const add = document.createElement('button');
    add.className = 'add-button';
    add.type = 'button';
    add.textContent = '+';
    add.setAttribute('aria-label', `Agregar ${product.name} a la venta`);
    add.disabled = Number(product.stock) <= 0;
    add.addEventListener('click', () => addToCart(product.productId));
    actions.append(adjust, add);
    bottom.append(price, actions);
    card.append(top, bottom);
    elements.products.append(card);
  }
}

function addToCart(productId) {
  const product = state.products.find((item) => item.productId === productId);
  const current = state.cart.get(productId) || 0;
  if (current + 1 > Number(product.stock)) {
    showNotice(`Solo hay ${quantityFormat.format(product.stock)} unidades disponibles.`, true);
    return;
  }
  state.cart.set(productId, current + 1);
  renderCart();
}

function changeQuantity(productId, change) {
  const product = state.products.find((item) => item.productId === productId);
  const next = (state.cart.get(productId) || 0) + change;
  if (next <= 0) {
    state.cart.delete(productId);
  } else if (next <= Number(product.stock)) {
    state.cart.set(productId, next);
  } else {
    showNotice(`Solo hay ${quantityFormat.format(product.stock)} unidades disponibles.`, true);
  }
  renderCart();
}

function renderCart() {
  elements.cartItems.replaceChildren();
  let itemCount = 0;
  let subtotal = 0;

  if (!state.cart.size) {
    const empty = document.createElement('div');
    empty.className = 'cart-empty';
    empty.textContent = 'Agrega productos desde el catálogo.';
    elements.cartItems.append(empty);
  }

  for (const [productId, quantity] of state.cart) {
    const product = state.products.find((item) => item.productId === productId);
    if (!product) continue;
    itemCount += quantity;
    subtotal += Math.round(Number(product.price) * quantity * 100) / 100;

    const row = document.createElement('div');
    row.className = 'cart-item';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'cart-item-name';
    name.textContent = product.name;
    const price = document.createElement('div');
    price.className = 'cart-item-price';
    price.textContent = formatCurrency(Number(product.price) * quantity);
    info.append(name, price);

    const controls = document.createElement('div');
    controls.className = 'cart-item-controls';
    controls.append(
      quantityButton('−', 'Reducir cantidad', () => changeQuantity(productId, -1)),
      Object.assign(document.createElement('span'), { className: 'quantity-value', textContent: quantityFormat.format(quantity) }),
      quantityButton('+', 'Aumentar cantidad', () => changeQuantity(productId, 1))
    );
    const remove = document.createElement('button');
    remove.className = 'remove-button';
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Quitar ${product.name}`);
    remove.addEventListener('click', () => { state.cart.delete(productId); renderCart(); });
    controls.append(remove);
    row.append(info, controls);
    elements.cartItems.append(row);
  }

  const tax = Math.round(subtotal * state.taxRate * 100) / 100;
  elements.cartCount.textContent = String(itemCount);
  elements.subtotal.textContent = formatCurrency(subtotal);
  elements.tax.textContent = formatCurrency(tax);
  elements.total.textContent = formatCurrency(subtotal + tax);
  elements.checkout.disabled = !state.cart.size || !state.cash;
}

function quantityButton(symbol, label, action) {
  const button = document.createElement('button');
  button.className = 'quantity-button';
  button.type = 'button';
  button.textContent = symbol;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', action);
  return button;
}

async function loadProducts() {
  state.products = await request('/api/products');
  renderProducts();
  renderCart();
}

async function loadCustomers() {
  state.customers = await request('/api/customers');
  for (const select of [elements.saleCustomer, document.querySelector('#sales-report-form [name="customerId"]')]) {
    const selected = select.value;
    select.replaceChildren(new Option(select === elements.saleCustomer ? 'Público general' : 'Todos los clientes', ''));
    for (const customer of state.customers) {
      select.add(new Option(customer.name, customer.customerId));
    }
    if ([...select.options].some((option) => option.value === selected)) {
      select.value = selected;
    }
  }
}

async function loadCashStatus() {
  state.cash = await request('/api/cash/status');
  const isOpen = Boolean(state.cash);
  elements.cashAction.textContent = isOpen ? 'Cerrar caja' : 'Abrir caja';
  elements.cashAction.className = `button ${isOpen ? 'button-dark' : 'button-outline'}`;
  elements.checkout.disabled = !state.cart.size || !isOpen;
}

async function loadSummary() {
  const summary = await request('/api/summary');
  elements.todaySales.textContent = formatCurrency(summary.totalToday);
  const count = Number(summary.salesToday);
  elements.salesCount.textContent = `${count} ${count === 1 ? 'venta' : 'ventas'}`;
}

async function loadConfig() {
  const config = await request('/api/config');
  state.taxRate = Number(config.taxRate);
  renderCart();
}

async function loadSales() {
  const sales = await request('/api/sales');
  elements.salesList.replaceChildren();
  if (!sales.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.className = 'empty-cell';
    cell.colSpan = 6;
    cell.textContent = 'Todavía no hay ventas.';
    row.append(cell);
    elements.salesList.append(row);
    return;
  }

  const paymentNames = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };
  for (const sale of sales) {
    const row = document.createElement('tr');
    const id = document.createElement('td');
    id.textContent = `#${sale.saleId}`;
    const date = document.createElement('td');
    date.textContent = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sale.createdAt));
    const payment = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = 'payment-tag';
    tag.textContent = paymentNames[sale.paymentMethod] || sale.paymentMethod;
    payment.append(tag);
    const total = document.createElement('td');
    total.className = 'align-right';
    total.textContent = formatCurrency(sale.total);
    const customer = document.createElement('td');
    customer.textContent = sale.customerName || 'Público general';
    const action = document.createElement('td');
    const print = document.createElement('button');
    print.className = 'button button-outline print-sale';
    print.type = 'button';
    print.textContent = 'Ticket';
    print.addEventListener('click', () => loadTicket(sale.saleId));
    action.append(print);
    row.append(id, date, customer, payment, total, action);
    elements.salesList.append(row);
  }
}

function reportParams(form) {
  return new URLSearchParams(new FormData(form));
}

function showEmptyRow(target, colspan, message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.className = 'empty-cell';
  cell.colSpan = colspan;
  cell.textContent = message;
  row.append(cell);
  target.replaceChildren(row);
}

async function loadSalesReport() {
  const params = reportParams(document.querySelector('#sales-report-form'));
  const report = await request(`/api/reports/sales?${params}`);
  const target = document.querySelector('#sales-report-list');
  const paymentNames = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };
  if (!report.sales.length) {
    showEmptyRow(target, 7, 'No hay ventas en el periodo seleccionado.');
  } else {
    target.replaceChildren();
    for (const sale of report.sales) {
      const row = document.createElement('tr');
      const values = [
        `#${sale.saleId}`,
        new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sale.createdAt)),
        sale.customerName,
        paymentNames[sale.paymentMethod] || sale.paymentMethod,
        formatCurrency(sale.subtotal),
        formatCurrency(sale.tax),
        formatCurrency(sale.total)
      ];
      for (const [index, value] of values.entries()) {
        const cell = document.createElement('td');
        cell.textContent = value;
        if (index >= 4) cell.className = 'align-right';
        row.append(cell);
      }
      target.append(row);
    }
  }
  document.querySelector('#sales-report-totals').textContent =
    `${report.totals.salesCount} ventas · Total ${formatCurrency(report.totals.total)}`;
}

async function loadCustomersReport() {
  const params = reportParams(document.querySelector('#customers-report-form'));
  const report = await request(`/api/reports/customers?${params}`);
  const target = document.querySelector('#customers-report-list');
  if (!report.customers.length) {
    showEmptyRow(target, 6, 'No hay clientes que coincidan con el reporte.');
  } else {
    target.replaceChildren();
    for (const customer of report.customers) {
      const row = document.createElement('tr');
      const values = [
        customer.name,
        customer.email || '—',
        customer.phone || '—',
        quantityFormat.format(customer.salesCount),
        formatCurrency(customer.totalSpent),
        customer.lastPurchase
          ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(customer.lastPurchase))
          : 'Sin compras'
      ];
      for (const [index, value] of values.entries()) {
        const cell = document.createElement('td');
        cell.textContent = value;
        if (index === 3 || index === 4) cell.className = 'align-right';
        row.append(cell);
      }
      target.append(row);
    }
  }
  document.querySelector('#customers-report-totals').textContent =
    `${report.totals.customersCount} clientes · ${report.totals.salesCount} ventas · ${formatCurrency(report.totals.totalSpent)}`;
}

async function loadTicket(saleId) {
  try {
    const sale = await request(`/api/sales/${saleId}`);
    renderTicket(sale);
    elements.ticketDialog.showModal();
  } catch (error) {
    showNotice(error.message, true);
  }
}

function renderTicket(sale) {
  const paymentNames = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };
  const date = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(sale.createdAt));
  const heading = document.createElement('header');
  const storeName = document.createElement('h2');
  storeName.textContent = 'SRV POS';
  const title = document.createElement('p');
  title.textContent = 'COMPROBANTE DE VENTA';
  const saleNumber = document.createElement('p');
  saleNumber.textContent = `Venta #${sale.saleId}`;
  const dateLabel = document.createElement('p');
  dateLabel.textContent = date;
  heading.append(storeName, title, saleNumber, dateLabel);
  if (sale.customerName) {
    const customer = document.createElement('p');
    customer.textContent = `Cliente: ${sale.customerName}`;
    heading.append(customer);
  }

  const table = document.createElement('table');
  const tableHead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Producto', 'Cant.', 'Precio', 'Importe']) {
    const cell = document.createElement('th');
    cell.textContent = label;
    headRow.append(cell);
  }
  tableHead.append(headRow);
  const tableBody = document.createElement('tbody');
  for (const item of sale.items) {
    const row = document.createElement('tr');
    for (const value of [
      item.name,
      quantityFormat.format(item.quantity),
      formatCurrency(item.unitPrice),
      formatCurrency(item.lineTotal)
    ]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    tableBody.append(row);
  }
  table.append(tableHead, tableBody);

  const totals = document.createElement('div');
  totals.className = 'ticket-totals';
  for (const [label, value] of [
    ['Subtotal', sale.subtotal],
    ['Impuestos', sale.tax],
    ['Total', sale.total]
  ]) {
    const line = document.createElement('p');
    const name = document.createElement('span');
    name.textContent = label;
    const amount = document.createElement('strong');
    amount.textContent = formatCurrency(value);
    line.append(name, amount);
    totals.append(line);
  }
  const payment = document.createElement('p');
  payment.className = 'ticket-payment';
  payment.textContent = `Pago: ${paymentNames[sale.paymentMethod] || sale.paymentMethod}`;
  const thanks = document.createElement('p');
  thanks.className = 'ticket-thanks';
  thanks.textContent = '¡Gracias por tu compra!';
  elements.ticketContent.replaceChildren(heading, table, totals, payment, thanks);
}

async function refreshDashboard() {
  try {
    await Promise.all([loadProducts(), loadCustomers(), loadCashStatus(), loadSummary(), loadSales(), loadConfig()]);
    setConnection(true);
  } catch (error) {
    setConnection(false);
    showNotice(error.message, true);
  }
}

elements.search.addEventListener('input', renderProducts);
document.querySelector('#show-product-form').addEventListener('click', () => elements.productDialog.showModal());
document.querySelectorAll('[data-show-customer-form]').forEach((button) => {
  button.addEventListener('click', () => elements.customerDialog.showModal());
});

document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach((item) => item.removeAttribute('aria-current'));
    link.setAttribute('aria-current', 'location');
    if (link.id === 'cash-nav-action') elements.cashAction.click();
  });
});

elements.productForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(elements.productForm);
  const submit = elements.productForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await request('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        sku: form.get('sku'),
        name: form.get('name'),
        price: Number(form.get('price')),
        stock: Number(form.get('stock'))
      })
    });
    elements.productForm.reset();
    elements.productDialog.close();
    showNotice('Producto agregado correctamente.');
    await loadProducts();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

elements.stockForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const adjustment = Number(elements.stockForm.elements.adjustment.value);
  if (!Number.isFinite(adjustment) || adjustment === 0) {
    showNotice('El ajuste debe ser distinto de cero.', true);
    return;
  }
  const submit = elements.stockForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await request(`/api/products/${elements.stockForm.dataset.productId}/stock`, {
      method: 'POST',
      body: JSON.stringify({ adjustment })
    });
    elements.stockDialog.close();
    showNotice('Existencia actualizada correctamente.');
    await loadProducts();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

elements.customerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(elements.customerForm);
  const submit = elements.customerForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const customer = await request('/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: form.get('name'),
        email: form.get('email'),
        phone: form.get('phone')
      })
    });
    elements.customerForm.reset();
    elements.customerDialog.close();
    await loadCustomers();
    elements.saleCustomer.value = customer.customerId;
    showNotice('Cliente agregado y seleccionado para la venta.');
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

for (const [formId, reportLoader] of [
  ['sales-report-form', loadSalesReport],
  ['customers-report-form', loadCustomersReport]
]) {
  document.querySelector(`#${formId}`).addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await reportLoader();
    } catch (error) {
      showNotice(error.message, true);
    }
  });
}

document.querySelectorAll('[data-export]').forEach((button) => {
  button.addEventListener('click', () => {
    const reportType = button.dataset.export;
    const form = document.querySelector(`#${reportType}-report-form`);
    if (!form.reportValidity()) return;
    window.location.assign(`/api/reports/${reportType}/export.xlsx?${reportParams(form)}`);
  });
});

document.querySelectorAll('[data-print]').forEach((button) => {
  button.addEventListener('click', async () => {
    const reportType = button.dataset.print;
    const form = document.querySelector(`#${reportType}-report-form`);
    if (!form.reportValidity()) return;
    try {
      if (reportType === 'sales') await loadSalesReport();
      else await loadCustomersReport();
      document.body.dataset.printReport = reportType;
      window.print();
    } catch (error) {
      showNotice(error.message, true);
    }
  });
});

document.querySelector('#print-ticket').addEventListener('click', () => {
  document.body.dataset.printTicket = 'true';
  window.print();
});
window.addEventListener('afterprint', () => {
  delete document.body.dataset.printReport;
  delete document.body.dataset.printTicket;
});

elements.cashAction.addEventListener('click', () => {
  const isOpen = Boolean(state.cash);
  document.querySelector('#cash-dialog-title').textContent = isOpen ? 'Cerrar caja' : 'Abrir caja';
  document.querySelector('#cash-help').textContent = isOpen
    ? 'Cuenta el efectivo y registra el total para cerrar el turno.'
    : 'Ingresa el efectivo con el que inicia el turno.';
  document.querySelector('#cash-amount-label').firstChild.textContent = isOpen ? 'Efectivo contado' : 'Fondo inicial';
  document.querySelector('#cash-submit').textContent = isOpen ? 'Cerrar caja' : 'Abrir caja';
  const expected = document.querySelector('#expected-cash');
  expected.hidden = !isOpen;
  expected.textContent = isOpen ? `Efectivo esperado: ${formatCurrency(state.cash.expectedCash)}` : '';
  elements.cashForm.dataset.action = isOpen ? 'close' : 'open';
  elements.cashForm.elements.amount.value = isOpen ? Number(state.cash.expectedCash).toFixed(2) : '0';
  elements.cashDialog.showModal();
});

elements.cashForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const isClosing = elements.cashForm.dataset.action === 'close';
  const path = isClosing ? '/api/cash/close' : '/api/cash/open';
  const field = isClosing ? 'closingCash' : 'openingCash';
  const submit = document.querySelector('#cash-submit');
  submit.disabled = true;
  try {
    await request(path, { method: 'POST', body: JSON.stringify({ [field]: Number(elements.cashForm.elements.amount.value) }) });
    elements.cashDialog.close();
    showNotice(isClosing ? 'Caja cerrada correctamente.' : 'Caja abierta. Ya puedes registrar ventas.');
    await loadCashStatus();
    renderCart();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

elements.checkout.addEventListener('click', async () => {
  elements.checkout.disabled = true;
  const soldItems = [...state.cart].map(([productId, quantity]) => {
    const product = state.products.find((item) => item.productId === productId);
    return {
      productId,
      name: product.name,
      quantity,
      unitPrice: Number(product.price),
      lineTotal: Math.round(Number(product.price) * quantity * 100) / 100
    };
  });
  const customerId = elements.saleCustomer.value;
  try {
    const sale = await request('/api/sales', {
      method: 'POST',
      body: JSON.stringify({
        items: soldItems.map(({ productId, quantity }) => ({ productId, quantity })),
        paymentMethod: elements.paymentMethod.value,
        customerId: customerId || null
      })
    });
    state.cart.clear();
    showNotice(`Venta #${sale.saleId} registrada por ${formatCurrency(sale.total)}.`);
    renderCart();
    renderTicket({
      ...sale,
      customerName: state.customers.find((customer) => customer.customerId === Number(customerId))?.name,
      items: soldItems
    });
    elements.ticketDialog.showModal();
    elements.saleCustomer.value = '';
    await refreshDashboard();
  } catch (error) {
    showNotice(error.message, true);
    await loadProducts();
  } finally {
    renderCart();
  }
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog').close());
});

elements.productDialog.addEventListener('click', (event) => {
  if (event.target === elements.productDialog) elements.productDialog.close();
});
elements.stockDialog.addEventListener('click', (event) => {
  if (event.target === elements.stockDialog) elements.stockDialog.close();
});
elements.cashDialog.addEventListener('click', (event) => {
  if (event.target === elements.cashDialog) elements.cashDialog.close();
});
elements.customerDialog.addEventListener('click', (event) => {
  if (event.target === elements.customerDialog) elements.customerDialog.close();
});
elements.ticketDialog.addEventListener('click', (event) => {
  if (event.target === elements.ticketDialog) elements.ticketDialog.close();
});

const today = new Date();
document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
}).format(today);

const localDate = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
for (const form of document.querySelectorAll('.report-filters')) {
  form.elements.from.value = localDate(firstOfMonth);
  form.elements.to.value = localDate(today);
}

refreshDashboard();
