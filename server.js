'use strict';

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const Product = require('./models/Product');
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(PUBLIC_DIR, 'uploads');
const MAX_MEDIA_FILES = 10;
const MAX_FILE_SIZE = Number(process.env.MAX_MEDIA_FILE_BYTES) || 50 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { files: MAX_MEDIA_FILES, fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, callback) => {
    const allowed = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
    callback(allowed ? null : new Error('Only image and video files are allowed.'), allowed);
  }
});

function requireAdmin(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return res.status(401).json({ message: 'Admin bearer token required. Sign in again.' });
  if (!JWT_SECRET) return res.status(500).json({ message: 'JWT_SECRET is not configured on the server.' });

  try {
    const payload = jwt.verify(match[1], JWT_SECRET);
    const role = String(payload.role || payload.user?.role || '').toLowerCase();
    if ((!['admin', 'administrator'].includes(role) && payload.isAdmin !== true) || payload.isAdmin === false) {
      return res.status(403).json({ message: 'Admin access required.' });
    }
    req.admin = payload;
    return next();
  } catch (_error) {
    return res.status(401).json({ message: 'Admin token is invalid or expired. Sign in again.' });
  }
}

async function deleteUploaded(files = []) {
  await Promise.all(files.map(file => fs.promises.unlink(file.path).catch(() => {})));
}

function uploadedMedia(files) {
  return files.map(file => ({
    originalName: file.originalname,
    filename: file.filename,
    path: `/uploads/${file.filename}`,
    mimeType: file.mimetype,
    mediaType: file.mimetype.startsWith('video/') ? 'video' : 'image',
    size: file.size
  }));
}

async function createProduct(req, res, next, respondWithJson) {
  const files = req.files || [];
  try {
    const { name, description, category, price, stock } = req.body;
    if (!String(name || '').trim() || !String(category || '').trim() || price === undefined || price === '' || stock === undefined || stock === '') {
      await deleteUploaded(files);
      return respondWithJson
        ? res.status(400).json({ message: 'Name, category, price, and stock are required.' })
        : res.status(400).send('Name, category, price, and stock are required.');
    }
    if (!files.length) {
      return respondWithJson
        ? res.status(400).json({ message: 'Select at least one image or video file.' })
        : res.status(400).send('Select at least one image or video file.');
    }

    const numericPrice = Number(price);
    const numericStock = Number(stock || 0);
    if (!Number.isFinite(numericPrice) || numericPrice < 0 || !Number.isInteger(numericStock) || numericStock < 0) {
      await deleteUploaded(files);
      return respondWithJson
        ? res.status(400).json({ message: 'Enter a valid price and whole-number stock quantity.' })
        : res.status(400).send('Enter a valid price and whole-number stock quantity.');
    }

    const sellerId = req.admin.id || req.admin._id || req.admin.userId || req.admin.sub ||
      req.admin.user?.id || req.admin.user?._id || req.admin.user?.userId;
    if (!sellerId || !mongoose.isValidObjectId(sellerId)) {
      await deleteUploaded(files);
      return respondWithJson
        ? res.status(401).json({ message: 'Admin token does not include a valid user ID.' })
        : res.status(401).send('Admin token does not include a valid user ID.');
    }

    const mediaFiles = uploadedMedia(files);
    const firstImage = mediaFiles.find(media => media.mediaType === 'image');
    const product = new Product({
      name: String(name).trim(),
      description: String(description || '').trim(),
      category: String(category).trim(),
      price: numericPrice,
      stock: numericStock,
      imageUrl: firstImage ? firstImage.path : '',
      seller: sellerId,
      mediaFiles,
      media: mediaFiles.map(media => media.path)
    });

    await product.save();
    if (respondWithJson) return res.status(201).json({ message: 'Product created successfully.', product });
    return res.redirect('/');
  } catch (error) {
    await deleteUploaded(files);
    return next(error);
  }
}

// Home page: render the existing catalog with the complete media array.
app.get('/', async (_req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).limit(12).lean();
    return res.render('index', { products });
  } catch (error) {
    console.error('Error loading homepage products:', error);
    return res.status(500).render('index', { products: [] });
  }
});

app.get('/add-listing', requireAdmin, (_req, res) => res.render('add-listing'));

// Admin product listing API used by the dashboard.
app.get('/api/products', requireAdmin, async (_req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    return res.json({ products });
  } catch (error) {
    return next(error);
  }
});

// Both admin upload paths accept the same multiple-file field and enforce JWT auth.
app.post('/api/products', requireAdmin, upload.array('mediaFiles', MAX_MEDIA_FILES), (req, res, next) => {
  createProduct(req, res, next, true);
});
app.post('/add-product', requireAdmin, upload.array('mediaFiles', MAX_MEDIA_FILES), (req, res, next) => {
  createProduct(req, res, next, false);
});

app.get('/product/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id).lean();
    if (!product) return res.status(404).send('Product not found');
    const related = await Product.find({ _id: { $ne: product._id } }).limit(4).lean();
    return res.render('product', { product, related });
  } catch (error) {
    console.error('Error loading product:', error);
    return res.status(500).send('Server Error');
  }
});

// Static storefront assets, plus file access for local disk or a mounted Render disk.
app.use('/uploads', express.static(UPLOAD_DIR, { fallthrough: false, dotfiles: 'deny' }));
app.use(express.static(PUBLIC_DIR, { index: false }));

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    const tooMany = error.code === 'LIMIT_FILE_COUNT';
    return res.status(tooLarge ? 413 : 400).json({
      message: tooMany ? `You can upload at most ${MAX_MEDIA_FILES} files at once.`
        : tooLarge ? `Each file must be no larger than ${Math.floor(MAX_FILE_SIZE / (1024 * 1024))} MB.`
          : error.message
    });
  }
  if (error.message === 'Only image and video files are allowed.') {
    return res.status(400).json({ message: error.message });
  }
  console.error('Request error:', error);
  return res.status(500).json({ message: 'Server Error' });
});

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/omnimart')
  .then(() => {
    console.log('MongoDB Connected Successfully');
    app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
  })
  .catch(error => {
    console.error('MongoDB Connection Error:', error);
    process.exit(1);
  });
