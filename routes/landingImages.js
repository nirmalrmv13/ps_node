const express = require('express');
const db = require('../db');
const { isAdmin, requireRole } = require('../auth');
const { hardDelete } = require('../hardDelete');
const { HttpError } = require('../errors');
const { number, text } = require('../validation');

const router = express.Router();

const SECTIONS = new Set(['hero', 'service', 'gallery', 'experience', 'visit']);

const columns =
  'id, section, title, alt_text AS altText, image_url AS imageUrl, sort_order AS sortOrder, is_active AS isActive';

function formatImage(row) {
  return { ...row, isActive: Boolean(row.isActive) };
}

function parseImage(body = {}) {
  const section = text(body.section, 'Section', { required: true, max: 20 });
  if (!SECTIONS.has(section)) {
    throw new HttpError(400, 'Section must be hero, service, gallery, experience, or visit.');
  }
  return {
    section,
    title: text(body.title, 'Title', { max: 100 }),
    alt_text: text(body.altText, 'Alt text', { max: 255 }),
    image_url: text(body.imageUrl, 'Image URL', { required: true, max: 1000 }),
    sort_order: number(body.sortOrder, 'Sort order', {
      required: true,
      min: 0,
      max: 9999,
      integer: true,
    }),
    is_active: body.isActive === false ? 0 : 1,
  };
}

async function findImage(id, includeInactive) {
  const [rows] = await db.query(
    `SELECT ${columns} FROM landing_images WHERE id = ?${includeInactive ? '' : ' AND is_active = 1'}`,
    [id],
  );
  return rows[0] ? formatImage(rows[0]) : null;
}

router.get('/', async (req, res) => {
  const includeInactive = req.query.all === '1' && isAdmin(req);
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  const [images] = await db.query(
    `SELECT ${columns} FROM landing_images ${where} ORDER BY section, sort_order, id`,
  );
  res.json({ count: images.length, images: images.map(formatImage) });
});

router.get('/:id', async (req, res) => {
  const image = await findImage(req.params.id, isAdmin(req));
  if (!image) {
    return res.status(404).json({ message: 'Landing image not found.' });
  }
  res.json({ image });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const image = parseImage(req.body);
  const [result] = await db.query('INSERT INTO landing_images SET ?', [image]);
  res.status(201).json({ image: await findImage(result.insertId, true) });
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const image = parseImage(req.body);
  const [result] = await db.query('UPDATE landing_images SET ? WHERE id = ?', [image, req.params.id]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ message: 'Landing image not found.' });
  }
  res.json({ image: await findImage(req.params.id, true) });
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  await hardDelete('landing_images', req.params.id, 'Landing image');
  res.json({ ok: true });
});

module.exports = router;
