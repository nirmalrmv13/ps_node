const PDFDocument = require('pdfkit');

function money(value) {
  return `INR ${Number(value || 0).toFixed(2)}`;
}

function formatWhen(value) {
  try {
    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return String(value ?? '');
  }
}

/** Builds a simple tax invoice PDF buffer. */
function buildInvoicePdf(invoice, { businessName, gstin } = {}) {
  const shop = businessName || process.env.BUSINESS_NAME || 'Salon';
  const halfRate = Number(invoice.totals?.gstRate || 0) / 2;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(shop, { align: 'left' });
    if (gstin) doc.fontSize(10).fillColor('#444').text(`GSTIN: ${gstin}`);
    doc.moveDown(0.5);
    doc.fillColor('#000').fontSize(14).text('Tax Invoice');
    doc.fontSize(10).text(`Invoice: ${invoice.invoiceNumber}`);
    doc.text(`Date: ${formatWhen(invoice.createdAt)}`);
    if (invoice.customer) {
      doc.text(`Customer: ${invoice.customer.name || 'Guest'}`);
      doc.text(`Mobile: ${invoice.customer.phone}`);
    }
    doc.moveDown();

    doc.fontSize(11).text('Items', { underline: true });
    doc.moveDown(0.3);
    for (const item of invoice.items || []) {
      const label = `${item.name} × ${item.quantity}`;
      doc.fontSize(10).text(label, { continued: true });
      doc.text(money(item.lineTotal), { align: 'right' });
    }

    doc.moveDown();
    const t = invoice.totals || {};
    const rows = [
      ['Subtotal', money(t.subtotal)],
      t.loyaltyDiscount > 0 ? ['Privilege discount', `- ${money(t.loyaltyDiscount)}`] : null,
      t.membershipDiscount > 0 ? ['Membership discount', `- ${money(t.membershipDiscount)}`] : null,
      t.discount > 0 ? ['Coupon discount', `- ${money(t.discount)}`] : null,
      ['Taxable value', money(t.taxableValue)],
      [`CGST ${halfRate}%`, money(t.cgst)],
      [`SGST ${halfRate}%`, money(t.sgst)],
      ['Total', money(t.total)],
    ].filter(Boolean);

    for (const [label, value] of rows) {
      doc.fontSize(10).text(label, { continued: true });
      doc.text(value, { align: 'right' });
    }

    doc.moveDown(1.5);
    doc.fontSize(9).fillColor('#555').text('Thank you for visiting.', {
      align: 'left',
    });
    doc.end();
  });
}

module.exports = { buildInvoicePdf };
