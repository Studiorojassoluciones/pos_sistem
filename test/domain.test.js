const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AppError,
  customerInput,
  productInput,
  reportDateBounds,
  reportDateRange,
  saleInput
} = require('../src/domain');

test('productInput trims text and validates price and stock', () => {
  assert.deepEqual(productInput({ sku: ' CAF-1 ', name: ' Café ', price: '25.50', stock: '3' }), {
    sku: 'CAF-1',
    name: 'Café',
    price: 25.5,
    stock: 3
  });
  assert.throws(() => productInput({ sku: '', name: 'Café', price: 25, stock: 1 }), AppError);
  assert.throws(() => productInput({ sku: 'CAF-1', name: 'Café', price: -1, stock: 1 }), AppError);
});

test('saleInput combines repeated products and validates the payment method', () => {
  assert.deepEqual(saleInput({
    items: [{ productId: 4, quantity: 1 }, { productId: '4', quantity: 2.5 }],
    paymentMethod: 'cash',
    customerId: '8'
  }), {
    items: [{ productId: 4, quantity: 3.5 }],
    paymentMethod: 'cash',
    customerId: 8
  });
  assert.throws(() => saleInput({ items: [], paymentMethod: 'cash' }), AppError);
  assert.throws(() => saleInput({ items: [{ productId: 4, quantity: 1 }], paymentMethod: 'check' }), AppError);
  assert.throws(() => saleInput({
    items: [{ productId: 4, quantity: 1 }], paymentMethod: 'cash', customerId: 'abc'
  }), AppError);
});

test('customerInput accepts optional contact details', () => {
  assert.deepEqual(customerInput({ name: ' Ana ', email: '', phone: null }), {
    name: 'Ana',
    email: null,
    phone: null
  });
  assert.throws(() => customerInput({ name: ' '.repeat(2) }), AppError);
});

test('reportDateRange validates complete, ordered calendar dates', () => {
  const range = reportDateRange({ from: '2026-03-01', to: '2026-03-31' });
  assert.deepEqual(range, {
    from: '2026-03-01',
    to: '2026-03-31'
  });
  const bounds = reportDateBounds(range);
  assert.equal(bounds.start.getFullYear(), 2026);
  assert.equal(bounds.start.getMonth(), 2);
  assert.equal(bounds.start.getDate(), 1);
  assert.equal(bounds.end.getFullYear(), 2026);
  assert.equal(bounds.end.getMonth(), 3);
  assert.equal(bounds.end.getDate(), 1);
  assert.throws(() => reportDateRange({ from: '2026-02-30', to: '2026-03-01' }), AppError);
  assert.throws(() => reportDateRange({ from: '2026-04-01', to: '2026-03-01' }), AppError);
});
