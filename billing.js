const { HttpError } = require('./errors');

const GST_RATE = Number(process.env.GST_RATE ?? 12);
const MAX_QUANTITY = 99;

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const formatRupees = (value) => `₹${value.toLocaleString('en-IN')}`;

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    throw new HttpError(400, 'Items must be a list.');
  }

  return items.map((item) => {
    const type = item?.type;
    const id = Number(item?.id);
    const quantity = Number(item?.quantity);

    if (!['service', 'product'].includes(type) || !Number.isInteger(id) || id <= 0) {
      throw new HttpError(400, 'Each item needs a valid type and id.');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new HttpError(400, `Quantity must be a whole number between 1 and ${MAX_QUANTITY}.`);
    }
    return { type, id, quantity };
  });
}

function normalizeUsage(usage) {
  if (usage == null) return [];
  if (!Array.isArray(usage)) {
    throw new HttpError(400, 'Product usage must be a list.');
  }

  const merged = new Map();
  for (const entry of usage) {
    const productId = Number(entry?.productId);
    const quantity = Number(entry?.quantity);
    const serviceId = entry?.serviceId == null || entry.serviceId === '' ? null : Number(entry.serviceId);

    if (!Number.isInteger(productId) || productId <= 0) {
      throw new HttpError(400, 'Each product usage needs a valid product.');
    }
    if (serviceId !== null && (!Number.isInteger(serviceId) || serviceId <= 0)) {
      throw new HttpError(400, 'Product usage has an invalid service.');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new HttpError(400, `Usage quantity must be a whole number between 1 and ${MAX_QUANTITY}.`);
    }

    const key = `${productId}:${serviceId ?? 0}`;
    const existing = merged.get(key);
    merged.set(key, { productId, serviceId, quantity: (existing?.quantity ?? 0) + quantity });
  }
  return [...merged.values()];
}

async function fetchRows(conn, table, ids, lock) {
  if (ids.length === 0) return new Map();

  const columns =
    table === 'services'
      ? 'id, name, category, duration_minutes, price'
      : 'id, name, brand, size, price, stock';
  const [rows] = await conn.query(
    `SELECT ${columns} FROM ${table} WHERE is_active = 1 AND id IN (?)${lock ? ' FOR UPDATE' : ''}`,
    [ids],
  );
  return new Map(rows.map((row) => [row.id, row]));
}

function calculateDiscount(coupon, subtotal) {
  let discount =
    coupon.discount_type === 'percent'
      ? (subtotal * coupon.discount_value) / 100
      : coupon.discount_value;
  if (coupon.max_discount != null) discount = Math.min(discount, coupon.max_discount);
  return round2(Math.min(discount, subtotal));
}

async function findCoupon(conn, code, subtotal) {
  const [rows] = await conn.query(
    `SELECT code, description, discount_type, discount_value, max_discount, min_subtotal
     FROM coupons WHERE is_active = 1 AND code = ?`,
    [code],
  );
  const coupon = rows[0];

  if (!coupon) {
    return { error: `Code ${code} is not valid.` };
  }
  if (subtotal < coupon.min_subtotal) {
    return {
      error: `Code ${code} needs a minimum folio value of ${formatRupees(coupon.min_subtotal)}.`,
    };
  }
  return { coupon };
}

/**
 * Prices a folio from the database. With `lock`, the product rows stay locked
 * until the surrounding transaction ends, so stock can't change underneath us.
 */
async function priceFolio(
  conn,
  rawItems,
  rawCouponCode,
  { lock = false, usage: rawUsage, freeServiceId: rawFreeServiceId } = {},
) {
  const items = normalizeItems(rawItems);
  const usageEntries = normalizeUsage(rawUsage);
  const idsOf = (type) => [...new Set(items.filter((i) => i.type === type).map((i) => i.id))];
  const productIds = [...new Set([...idsOf('product'), ...usageEntries.map((u) => u.productId)])];

  const services = await fetchRows(conn, 'services', idsOf('service'), lock);
  const products = await fetchRows(conn, 'products', productIds, lock);

  const lines = items.map((item) => {
    const row = (item.type === 'service' ? services : products).get(item.id);
    if (!row) {
      throw new HttpError(400, `That ${item.type} is no longer available.`);
    }

    return {
      type: item.type,
      id: item.id,
      name: row.name,
      detail:
        item.type === 'service'
          ? `${row.category} • ${row.duration_minutes} min`
          : [row.brand, row.size].filter(Boolean).join(' • '),
      quantity: item.quantity,
      rate: row.price,
      lineTotal: round2(row.price * item.quantity),
      ...(item.type === 'product' && { stock: row.stock }),
    };
  });

  const usage = usageEntries.map((entry) => {
    const product = products.get(entry.productId);
    if (!product) {
      throw new HttpError(400, 'A product in the usage list is no longer available.');
    }
    const service = entry.serviceId === null ? null : services.get(entry.serviceId);
    if (entry.serviceId !== null && !service) {
      throw new HttpError(400, `${product.name} is linked to a service that is not on this bill.`);
    }

    return {
      productId: product.id,
      productName: product.name,
      quantity: entry.quantity,
      unitValue: product.price,
      stock: product.stock,
      serviceId: service?.id ?? null,
      serviceName: service?.name ?? null,
    };
  });

  const subtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  let freeService = null;
  if (rawFreeServiceId != null && rawFreeServiceId !== '') {
    const line = lines.find((l) => l.type === 'service' && l.id === Number(rawFreeServiceId));
    if (!line) {
      throw new HttpError(400, 'The free service must be one of the services on this bill.');
    }
    freeService = { id: line.id, name: line.name, value: round2(Number(line.rate)) };
  }
  const loyaltyDiscount = freeService?.value ?? 0;
  const payable = round2(subtotal - loyaltyDiscount);

  const code = typeof rawCouponCode === 'string' ? rawCouponCode.trim().toUpperCase() : '';
  const { coupon, error: couponError } = code ? await findCoupon(conn, code, payable) : {};

  const discount = coupon ? calculateDiscount(coupon, payable) : 0;
  const taxableValue = round2(payable - discount);
  const serviceUnits = lines.filter((l) => l.type === 'service').reduce((sum, l) => sum + l.quantity, 0);
  const cgst = round2((taxableValue * GST_RATE) / 200);
  const sgst = cgst;

  return {
    lines,
    usage,
    coupon: coupon ? { code: coupon.code, description: coupon.description } : null,
    couponError: couponError ?? null,
    freeService,
    starsEarned: serviceUnits - (freeService ? 1 : 0),
    totals: {
      subtotal,
      loyaltyDiscount,
      discount,
      taxableValue,
      gstRate: GST_RATE,
      cgst,
      sgst,
      total: round2(taxableValue + cgst + sgst),
    },
  };
}

module.exports = { GST_RATE, priceFolio };
