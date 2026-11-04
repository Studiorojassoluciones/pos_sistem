class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requiredText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new AppError(400, `${label} es obligatorio y debe tener máximo ${maxLength} caracteres.`);
  }

  return value.trim();
}

function nonNegativeNumber(value, label, max = 100000000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
    throw new AppError(400, `${label} debe ser un número entre 0 y ${max}.`);
  }

  return parsed;
}

function positiveNumber(value, label, max = 100000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) {
    throw new AppError(400, `${label} debe ser mayor que 0 y no exceder ${max}.`);
  }

  return parsed;
}

function productInput(body) {
  return {
    sku: requiredText(body.sku, 'El código', 50),
    name: requiredText(body.name, 'El nombre', 150),
    price: nonNegativeNumber(body.price, 'El precio'),
    stock: nonNegativeNumber(body.stock, 'La existencia', 100000000)
  };
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > maxLength) {
    throw new AppError(400, `${label} debe tener máximo ${maxLength} caracteres.`);
  }
  return value.trim() || null;
}

function customerInput(body) {
  return {
    name: requiredText(body.name, 'El nombre del cliente', 150),
    email: optionalText(body.email, 'El correo', 254),
    phone: optionalText(body.phone, 'El teléfono', 30)
  };
}

function reportDateRange(query) {
  const { from, to } = query;
  const validDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(from) || !validDate(to)) {
    throw new AppError(400, 'Indica un rango de fechas válido con formato AAAA-MM-DD.');
  }
  if (from > to) {
    throw new AppError(400, 'La fecha inicial no puede ser posterior a la fecha final.');
  }
  return { from, to };
}

function reportDateBounds(range) {
  const start = new Date(`${range.from}T00:00:00`);
  const end = new Date(`${range.to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function saleInput(body) {
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
    throw new AppError(400, 'La venta debe incluir de 1 a 100 productos.');
  }

  const quantities = new Map();
  for (const item of body.items) {
    const productId = Number(item.productId);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
      throw new AppError(400, 'El identificador de producto no es válido.');
    }

    const quantity = positiveNumber(item.quantity, 'La cantidad', 100000);
    const combined = (quantities.get(productId) || 0) + quantity;
    if (combined > 100000) {
      throw new AppError(400, 'La cantidad solicitada es demasiado grande.');
    }
    quantities.set(productId, combined);
  }

  const paymentMethod = body.paymentMethod;
  if (!['cash', 'card', 'transfer'].includes(paymentMethod)) {
    throw new AppError(400, 'El método de pago debe ser efectivo, tarjeta o transferencia.');
  }

  let customerId = null;
  if (body.customerId !== undefined && body.customerId !== null && body.customerId !== '') {
    customerId = Number(body.customerId);
    if (!Number.isSafeInteger(customerId) || customerId <= 0 || customerId > 2147483647) {
      throw new AppError(400, 'El identificador del cliente no es válido.');
    }
  }

  return {
    items: [...quantities].map(([productId, quantity]) => ({ productId, quantity })),
    paymentMethod,
    customerId
  };
}

module.exports = {
  AppError,
  customerInput,
  nonNegativeNumber,
  positiveNumber,
  productInput,
  reportDateBounds,
  reportDateRange,
  requiredText,
  saleInput
};
