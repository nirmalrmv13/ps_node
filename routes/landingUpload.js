const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { HttpError } = require('../errors');

const router = express.Router();

const MEDIA_DIR = path.join(__dirname, '..', 'public', 'landing');
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

fs.mkdirSync(MEDIA_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: MEDIA_DIR,
    filename(req, file, cb) {
      const ext = ALLOWED.get(file.mimetype) || path.extname(file.originalname).toLowerCase();
      const safeExt = [...ALLOWED.values()].includes(ext) ? ext : '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
    },
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new HttpError(400, 'Upload a JPG, PNG, WEBP, or GIF image.'));
    }
    cb(null, true);
  },
});

router.post('/', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new HttpError(400, 'Image must be 5 MB or smaller.'));
      }
      return next(new HttpError(400, err.message));
    }
    if (err) return next(err);
    if (!req.file) {
      return next(new HttpError(400, 'Choose an image file to upload.'));
    }

    res.status(201).json({
      imageUrl: `/api/public/landing-media/${req.file.filename}`,
      fileName: req.file.filename,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  });
});

module.exports = router;
