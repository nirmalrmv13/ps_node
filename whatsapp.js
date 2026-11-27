/**
 * GetEcho WA Gateway — auto-send invoice after billing settle.
 *
 * POST https://waengine.getecho.co.in/api/v1/send.php
 * Authorization: Bearer <API_KEY>
 * Content-Type: application/json
 *
 * Text:     { phone, message }
 * Document: { phone, type: "document", url, filename, message }
 * (This account: images & documents by public URL only.)
 */

const jwt = require('jsonwebtoken');

function whatsappConfig() {
  const apiKey =
    process.env.GETECHO_API_KEY?.trim() ||
    process.env.WAECHO_ACCESS_TOKEN?.trim() ||
    process.env.WHATSAPP_API_KEY?.trim();
  const sendUrl = (
    process.env.GETECHO_SEND_URL ||
    process.env.WAECHO_SEND_URL ||
    process.env.WHATSAPP_SEND_URL ||
    'https://waengine.getecho.co.in/api/v1/send.php'
  ).trim();
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || '')
    .trim()
    .replace(/\/$/, '');
  return {
    apiKey,
    sendUrl,
    publicBaseUrl,
    configured: Boolean(apiKey),
  };
}

function isWhatsAppConfigured() {
  return whatsappConfig().configured;
}

/** India-friendly E.164 without plus: 91XXXXXXXXXX */
function toWhatsAppRecipient(phone) {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) digits = `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

function formatInr(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? `₹${n}` : `₹${n.toFixed(2)}`;
}

function invoiceContactPhone() {
  return (process.env.BUSINESS_PHONE || process.env.GETECHO_FROM_NUMBER || '9894451405').replace(/\D/g, '') || '9894451405';
}

function invoiceWebsite() {
  return (process.env.BUSINESS_WEBSITE || 'www.prosignature.in').replace(/^https?:\/\//i, '');
}

/** ProSignature WhatsApp invoice template (text + PDF caption). */
function invoiceMessageText(invoice) {
  const name = invoice.customer?.name || 'Customer';
  const invoiceNo = invoice.invoiceNumber || '—';
  const amount = formatInr(invoice.totals?.total);
  const paymentStatus = invoice.paymentStatus || invoice.totals?.paymentStatus || 'PAID';
  const phone = invoiceContactPhone();
  const website = invoiceWebsite();

  return [
    '✨ *PROSIGNATURE UNISEX SALON*',
    '',
    `Dear ${name},`,
    '',
    'Thank you for choosing ProSignature!',
    '',
    'Your service has been completed successfully.',
    '',
    '🧾 *Your Invoice Details*',
    `Invoice No: ${invoiceNo}`,
    `Amount: ${amount}`,
    `Payment Status: ${paymentStatus}`,
    '',
    'Your detailed invoice is attached as a PDF.',
    '',
    'We look forward to seeing you again!',
    '',
    `📞 ${phone}`,
    `🌐 ${website}`,
    '',
    '*ProSignature – Your Style, Our Signature.* ❤️',
  ].join('\n');
}

function documentCaption(invoice) {
  return invoiceMessageText(invoice);
}

/** Short-lived public PDF link GetEcho can fetch (requires PUBLIC_BASE_URL). */
function createInvoicePdfShareUrl(invoice) {
  const { publicBaseUrl } = whatsappConfig();
  const secret = process.env.JWT_SECRET;
  if (!publicBaseUrl || !secret || !invoice?.id) return null;

  const token = jwt.sign(
    { purpose: 'invoice-pdf', invoiceId: String(invoice.id) },
    secret,
    { expiresIn: '2h' },
  );
  return `${publicBaseUrl}/api/public/invoices/${encodeURIComponent(invoice.id)}/pdf?token=${encodeURIComponent(token)}`;
}

function verifyInvoicePdfShareToken(token, invoiceId) {
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) return false;
  try {
    const payload = jwt.verify(token, secret);
    return payload.purpose === 'invoice-pdf' && String(payload.invoiceId) === String(invoiceId);
  } catch {
    return false;
  }
}

function isGetEchoSuccess(res, data) {
  if (!res.ok) return false;
  if (data.status === 'error' || data.success === false || data.success === 'false') return false;
  if (data.error && data.status !== 'ok' && data.success !== true && data.success !== 'true') {
    return false;
  }
  return true;
}

async function getEchoSend(payload) {
  const cfg = whatsappConfig();
  const res = await fetch(cfg.sendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!isGetEchoSuccess(res, data)) {
    let detail =
      data.error ||
      data.message ||
      (typeof data.raw === 'string' ? data.raw.slice(0, 200) : '') ||
      res.statusText ||
      'GetEcho WhatsApp API error';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
    if (/session_disconnected|device not connected/i.test(detail)) {
      detail =
        'GetEcho WhatsApp is disconnected. Open the GetEcho panel → Connection, reconnect QR/pairing, then Resend.';
    }
    if (/invalid|revoked/i.test(detail) && (res.status === 401 || /api[_ ]?key/i.test(detail))) {
      detail =
        'GetEcho API key is invalid. Update GETECHO_API_KEY in .env from the GetEcho API Key page, then restart the API.';
    }
    const err = new Error(detail);
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

/**
 * Sends the invoice via GetEcho to the customer WhatsApp.
 * Prefers PDF document by public URL; otherwise text bill.
 * Never throws for settle flow — returns { status, message?, to? }.
 */
async function sendInvoiceWhatsApp(invoice, _options = {}) {
  const cfg = whatsappConfig();

  if (!cfg.configured) {
    return {
      status: 'skipped',
      message: 'GetEcho WhatsApp is not configured (set GETECHO_API_KEY in .env).',
    };
  }

  if (!invoice?.customer?.phone) {
    return { status: 'skipped', message: 'No customer mobile on this invoice.' };
  }

  const to = toWhatsAppRecipient(invoice.customer.phone);
  if (!to) {
    return { status: 'failed', message: 'Customer mobile number is invalid for WhatsApp.' };
  }

  const filename = `${invoice.invoiceNumber || `invoice-${invoice.id}`}.pdf`;
  const pdfUrl = createInvoicePdfShareUrl(invoice);

  try {
    if (pdfUrl) {
      await getEchoSend({
        phone: to,
        type: 'document',
        url: pdfUrl,
        filename,
        message: documentCaption(invoice),
      });
      return { status: 'sent', to, message: `Invoice PDF sent on WhatsApp to ${to}.` };
    }

    await getEchoSend({
      phone: to,
      message: invoiceMessageText(invoice),
    });
    return {
      status: 'sent',
      to,
      message: `Invoice text sent on WhatsApp to ${to}. Set PUBLIC_BASE_URL to also attach the PDF.`,
    };
  } catch (err) {
    console.error('WhatsApp send failed:', err.message, err.payload || '');
    return {
      status: 'failed',
      to,
      message: err.message || 'WhatsApp send failed.',
    };
  }
}

module.exports = {
  isWhatsAppConfigured,
  sendInvoiceWhatsApp,
  toWhatsAppRecipient,
  invoiceMessageText,
  createInvoicePdfShareUrl,
  verifyInvoicePdfShareToken,
};
