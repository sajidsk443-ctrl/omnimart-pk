'use strict';

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Cloudinary اور Multer Storage لائبریریز
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Cloudinary کنفیگریشن (.env فائل سے تفصیلات خود بخود اٹھائے گا)
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME || process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY || process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET || process.env.CLOUDINARY_API_SECRET
});

const Product = require('./models/Product');

const Order = mongoose.models.OmniMartOrder || mongoose.model('OmniMartOrder', new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  productName: { type: String, required: true, trim: true, maxlength: 160 },
  quantity: { type: Number, required: true, min: 1, max: 20 },
  unitPrice: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'PKR', enum: ['PKR'] },
  paymentMethod: { type: String, default: 'COD', enum: ['COD'] },
  customer: {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    address: { type: String, required: true, trim: true, maxlength: 500 }
  },
  fulfillmentStatus: { type: String, default: 'Pending Confirmation', index: true },
  status: { type: String, default: 'Pending Confirmation' }
}, { timestamps: true, collection: 'omnimart_orders' }));

let User = null;
try {
  User = mongoose.models.User || require('./models/User');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' || !String(error.message).includes('./models/User')) throw error;
}

let bcrypt = null;
try { bcrypt = require('bcrypt'); } catch (_) {
  try { bcrypt = require('bcryptjs'); } catch (_) { /* comparePassword */ }
}
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_MEDIA_FILES = 10;
const MAX_FILE_SIZE = Number(process.env.MAX_MEDIA_FILE_BYTES) || 50 * 1024 * 1024;

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const orderRateWindows = new Map();
const ORDER_RATE_LIMIT = Math.max(1, Number(process.env.ORDER_RATE_LIMIT) || 8);
const ORDER_RATE_WINDOW_MS = Math.max(60_000, Number(process.env.ORDER_RATE_WINDOW_MS) || 15 * 60_000);
function allowOrderSubmission(req) {
  const now = Date.now();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const current = orderRateWindows.get(ip);
  if (!current || current.resetAt <= now) {
    orderRateWindows.set(ip, { count: 1, resetAt: now + ORDER_RATE_WINDOW_MS });
    return true;
  }
  if (current.count >= ORDER_RATE_LIMIT) return false;
  current.count += 1;
  return true;
}
function normalizePakistaniMobile(value) {
  const raw = String(value || '').trim();
  const compact = raw.replace(/[\s()-]/g, '');
  if (/^03\d{9}$/.test(compact)) return '+92' + compact.slice(1);
  if (/^\+923\d{9}$/.test(compact)) return compact;
  if (/^923\d{9}$/.test(compact)) return '+' + compact;
  return null;
}
function makeOrderNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `OM-${date}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function jsonAuthFailure(res, status, message) {
  return res.status(status).json({ success: false, message });
}

async function verifyLoginPassword(user, submittedPassword) {
  if (typeof user.comparePassword === 'function') {
    return Boolean(await user.comparePassword(submittedPassword));
  }
  const storedHash = user.passwordHash || user.password;
  if (typeof storedHash !== 'string' || !/^\$2[aby]\$/.test(storedHash) || !bcrypt) return false;
  return bcrypt.compare(submittedPassword, storedHash);
}

// Authentication API
app.post(['/api/auth/login', '/api/login'], async (req, res) => {
  try {
    if (!User) return jsonAuthFailure(res, 503, 'Login is not configured: models/User.js was not found.');
    if (!JWT_SECRET) return jsonAuthFailure(res, 500, 'Login is not configured: JWT_SECRET is missing.');

    const identity = String(req.body?.email || req.body?.username || req.body?.phone || req.body?.identifier || '').trim();
    const password = req.body?.password;
    if (!identity || typeof password !== 'string' || !password) {
      return jsonAuthFailure(res, 400, 'Enter your email, username, or phone number and password.');
    }

    const identityFields = ['email', 'username', 'phone', 'mobile'].filter(field => User.schema.path(field));
    if (!identityFields.length) return jsonAuthFailure(res, 500, 'User model has no supported login identity field.');
    const identityQuery = identityFields.map(field => ({ [field]: identity }));
    const user = await User.findOne({ $or: identityQuery }).select('+password +passwordHash');
    if (!user || user.active === false || user.isActive === false || !(await verifyLoginPassword(user, password))) {
      return jsonAuthFailure(res, 401, 'Invalid login credentials.');
    }

    const role = String(user.role || (user.isAdmin ? 'admin' : user.isSeller ? 'seller' : 'user')).toLowerCase();
    const userId = user._id.toString();
    const token = jwt.sign({ id: userId, role, isAdmin: role === 'admin' || role === 'administrator' }, JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
    const safeUser = {
      id: userId,
      name: user.name || user.fullName || '',
      email: user.email || '',
      role
    };
    return res.status(200).json({ success: true, token, user: safeUser });
  } catch (error) {
    console.error('Login error:', error);
    return jsonAuthFailure(res, 500, 'Unable to complete login right now.');
  }
});



// Seller accounts use a separate collection so the existing User model and admin login remain untouched.
const Seller = mongoose.models.OmniMartSeller || mongoose.model('OmniMartSeller', new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  phone: { type: String, required: true, trim: true, maxlength: 25 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, default: 'seller', enum: ['seller'] },
  termsAcceptedAt: { type: Date, required: true },
  termsVersion: { type: String, required: true }
}, { timestamps: true, collection: 'omnimart_sellers' }));

const SellerOtp = mongoose.models.OmniMartSellerOtp || mongoose.model('OmniMartSellerOtp', new mongoose.Schema({
  email: { type: String, required: true, index: true },
  hash: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  attempts: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'omnimart_seller_otps' }));

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* seller recovery reports unavailable until installed */ }
const sellerMailer = nodemailer ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
}) : null;
const SELLER_TERMS_VERSION = process.env.SELLER_TERMS_VERSION || '2026-10-20';
const OTP_SECRET = process.env.OTP_SECRET || JWT_SECRET;
const normalizeEmail = value => String(value || '').trim().toLowerCase();
function sellerToken(seller) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured.');
  return jwt.sign({ id: seller.id, role: 'seller', isAdmin: false }, JWT_SECRET, {
    expiresIn: process.env.SELLER_JWT_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '7d'
  });
}
function sellerOtpDigest(email, code) {
  if (!OTP_SECRET) throw new Error('OTP_SECRET or JWT_SECRET must be configured.');
  return crypto.createHmac('sha256', OTP_SECRET).update(`${email}:${code}`).digest('hex');
}
function safeHexEqual(left, right) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sellerFailure(res, status, message) {
  return res.status(status).json({ success: false, message });
}

// Dedicated seller registration. The accepted terms version and timestamp are stored with the account.
app.post('/api/seller/auth/register', async (req, res) => {
  try {
    const { name, phone, password, termsAccepted } = req.body || {};
    const email = normalizeEmail(req.body?.email);
    if (!String(name || '').trim() || !/^\S+@\S+\.\S+$/.test(email) || !String(phone || '').trim()) {
      return sellerFailure(res, 400, 'Enter your name, valid email, and phone number.');
    }
    if (typeof password !== 'string' || password.length < 8) {
      return sellerFailure(res, 400, 'Password must contain at least 8 characters.');
    }
    if (termsAccepted !== true) {
      return sellerFailure(res, 400, 'You must agree to the Seller Terms & Conditions.');
    }
    if (!bcrypt) return sellerFailure(res, 503, 'Seller authentication requires bcrypt or bcryptjs.');
    if (await Seller.exists({ email })) return sellerFailure(res, 409, 'An account with this email already exists.');

    const seller = await Seller.create({
      name: String(name).trim(), email, phone: String(phone).trim(),
      passwordHash: await bcrypt.hash(password, 12),
      termsAcceptedAt: new Date(), termsVersion: SELLER_TERMS_VERSION
    });
    return res.status(201).json({
      success: true, token: sellerToken(seller),
      seller: { id: seller.id, name: seller.name, email: seller.email, role: 'seller' }
    });
  } catch (error) {
    if (error.code === 11000) return sellerFailure(res, 409, 'An account with this email already exists.');
    console.error('Seller registration error:', error);
    return sellerFailure(res, 500, 'Unable to create seller account.');
  }
});

// Dedicated seller login; this does not authenticate admin accounts.
app.post('/api/seller/auth/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    if (!email || typeof password !== 'string') return sellerFailure(res, 400, 'Enter your email and password.');
    if (!bcrypt) return sellerFailure(res, 503, 'Seller authentication requires bcrypt or bcryptjs.');
    const seller = await Seller.findOne({ email }).select('+passwordHash');
    if (!seller || !(await bcrypt.compare(password, seller.passwordHash))) {
      return sellerFailure(res, 401, 'Invalid email or password.');
    }
    return res.json({
      success: true, token: sellerToken(seller),
      seller: { id: seller.id, name: seller.name, email: seller.email, role: 'seller' }
    });
  } catch (error) {
    console.error('Seller login error:', error);
    return sellerFailure(res, 500, 'Unable to sign in right now.');
  }
});

// Email a six-digit, five-minute recovery code. The response is intentionally generic to limit account discovery.
app.post('/api/seller/auth/forgot', async (req, res) => {
  const generic = { success: true, message: 'If an account exists for that email, an OTP has been sent.' };
  try {
    const email = normalizeEmail(req.body?.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) return sellerFailure(res, 400, 'Enter a valid email address.');
    if (!sellerMailer || !process.env.SMTP_HOST || !process.env.SMTP_FROM && !process.env.SMTP_USER) {
      return sellerFailure(res, 503, 'Password recovery email is not configured on the server.');
    }
    const seller = await Seller.findOne({ email });
    if (!seller) return res.json(generic);
    const recent = await SellerOtp.findOne({ email, createdAt: { $gt: new Date(Date.now() - 60_000) } });
    if (recent) return res.json(generic);

    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await SellerOtp.deleteMany({ email });
    await SellerOtp.create({ email, hash: sellerOtpDigest(email, otp), expiresAt: new Date(Date.now() + 5 * 60_000) });
    await sellerMailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'OmniMart seller password reset code',
      text: `Your OmniMart password reset code is ${otp}. It expires in 5 minutes. If you did not request this, ignore this email.`
    });
    return res.json(generic);
  } catch (error) {
    console.error('Seller OTP email error:', error);
    return sellerFailure(res, 503, 'Password recovery email is temporarily unavailable.');
  }
});

// Verify OTP and replace the seller password.
app.post('/api/seller/auth/reset', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || '');
    const password = req.body?.password;
    if (!/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(otp)) {
      return sellerFailure(res, 400, 'Enter the email and six-digit OTP.');
    }
    if (typeof password !== 'string' || password.length < 8) {
      return sellerFailure(res, 400, 'New password must contain at least 8 characters.');
    }
    if (!bcrypt) return sellerFailure(res, 503, 'Seller authentication requires bcrypt or bcryptjs.');
    const record = await SellerOtp.findOne({ email, expiresAt: { $gt: new Date() } });
    if (!record) return sellerFailure(res, 400, 'OTP is invalid or expired. Request a new code.');
    if (record.attempts >= 5) {
      await record.deleteOne();
      return sellerFailure(res, 429, 'Too many attempts. Request a new code.');
    }
    if (!safeHexEqual(record.hash, sellerOtpDigest(email, otp))) {
      record.attempts += 1;
      await record.save();
      return sellerFailure(res, 400, 'OTP is invalid or expired.');
    }
    const seller = await Seller.findOne({ email });
    if (!seller) {
      await record.deleteOne();
      return sellerFailure(res, 400, 'OTP is invalid or expired.');
    }
    seller.passwordHash = await bcrypt.hash(password, 12);
    await seller.save();
    await SellerOtp.deleteMany({ email });
    return res.json({ success: true, message: 'Password updated. You can sign in.' });
  } catch (error) {
    console.error('Seller password reset error:', error);
    return sellerFailure(res, 500, 'Unable to reset password right now.');
  }
});

// Cloudinary Storage (مقامی لوکل ڈسک کے بجائے کلاؤڈ پر اپلوڈ کرے گا)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'omnimart_products',
    resource_type: 'auto',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'avi']
  }
});

const upload = multer({
  storage,
  limits: { files: MAX_MEDIA_FILES, fileSize: MAX_FILE_SIZE }
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

function uploadedMedia(files) {
  return files.map(file => ({
    originalName: file.originalname,
    filename: file.filename || file.public_id,
    path: file.path, // Cloudinary URL
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
      return respondWithJson
        ? res.status(400).json({ message: 'Enter a valid price and whole-number stock quantity.' })
        : res.status(400).send('Enter a valid price and whole-number stock quantity.');
    }

    const sellerId = req.admin.id || req.admin._id || req.admin.userId || req.admin.sub ||
      req.admin.user?.id || req.admin.user?._id || req.admin.user?.userId;
    if (!sellerId || !mongoose.isValidObjectId(sellerId)) {
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
      imageUrl: firstImage ? firstImage.path : (mediaFiles[0] ? mediaFiles[0].path : ''),
      seller: sellerId,
      mediaFiles,
      media: mediaFiles.map(media => media.path)
    });

    await product.save();
    if (respondWithJson) return res.status(201).json({ message: 'Product created successfully.', product });
    return res.redirect('/');
  } catch (error) {
    return next(error);
  }
}

// Storefront routes
app.get('/', (_req, res, next) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), error => {
    if (error) next(error);
  });
});

app.get(['/admin', '/admin.html'], (_req, res, next) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'), error => {
    if (error) next(error);
  });
});

app.get(['/seller', '/seller.html'], (_req, res, next) => {
  res.sendFile(path.join(PUBLIC_DIR, 'seller.html'), error => {
    if (error) next(error);
  });
});

app.get('/add-listing', requireAdmin, (_req, res) => res.render('add-listing'));

app.get('/api/catalog/products', async (_req, res, next) => {
  try {
    const products = await Product.find({ active: { $ne: false } })
      .select('name description category price stock imageUrl mediaFiles media createdAt')
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ products });
  } catch (error) {
    return next(error);
  }
});

// Public Cash on Delivery order submission. The browser's price/name/total are never trusted.
app.post('/api/orders', async (req, res, next) => {
  try {
    if (!allowOrderSubmission(req)) {
      res.set('Retry-After', String(Math.ceil(ORDER_RATE_WINDOW_MS / 1000)));
      return res.status(429).json({ success: false, message: 'Too many order attempts. Please try again later.' });
    }

    const body = req.body || {};
    const productId = String(body.productId || '').trim();
    const quantity = Number(body.quantity);
    const customer = body.customer || {};
    const name = String(customer.name || '').trim();
    const phone = normalizePakistaniMobile(customer.phone);
    const city = String(customer.city || '').trim();
    const address = String(customer.address || '').trim();

    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ success: false, message: 'The selected product is invalid. Refresh the page and try again.' });
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return res.status(400).json({ success: false, message: 'Quantity must be a whole number between 1 and 20.' });
    }
    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ success: false, message: 'Enter a name between 2 and 100 characters.' });
    }
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Enter a valid Pakistani mobile number, such as 03XXXXXXXXX.' });
    }
    if (!city || city.length > 80) {
      return res.status(400).json({ success: false, message: 'Enter your city (up to 80 characters).' });
    }
    if (address.length < 8 || address.length > 500) {
      return res.status(400).json({ success: false, message: 'Enter a delivery address between 8 and 500 characters.' });
    }

    const product = await Product.findOne({ _id: productId, active: { $ne: false } })
      .select('name title price stock active')
      .lean();
    if (!product) {
      return res.status(404).json({ success: false, message: 'This product is no longer available.' });
    }
    const unitPrice = Number(product.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      console.error('COD order rejected: product has invalid price', productId);
      return res.status(409).json({ success: false, message: 'This product cannot be ordered right now. Please contact support.' });
    }
    const availableStock = Number(product.stock);
    if (Number.isFinite(availableStock) && availableStock < quantity) {
      return res.status(409).json({ success: false, message: 'The requested quantity is currently unavailable.' });
    }

    const order = await Order.create({
      orderNumber: makeOrderNumber(),
      product: product._id,
      productName: String(product.name || product.title || 'Product').trim().slice(0, 160),
      quantity,
      unitPrice,
      total: Number((unitPrice * quantity).toFixed(2)),
      currency: 'PKR',
      paymentMethod: 'COD',
      customer: { name, phone, city, address },
      fulfillmentStatus: 'Pending Confirmation',
      status: 'Pending Confirmation'
    });

    return res.status(201).json({
      success: true,
      message: 'Order received! OmniMart will contact you to confirm.',
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        productId: String(order.product),
        productName: order.productName,
        quantity: order.quantity,
        unitPrice: order.unitPrice,
        total: order.total,
        currency: order.currency,
        paymentMethod: order.paymentMethod,
        fulfillmentStatus: order.fulfillmentStatus
      }
    });
  } catch (error) {
    console.error('COD order creation error:', error);
    return next(error);
  }
});

const orderRateCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, window] of orderRateWindows) if (window.resetAt <= now) orderRateWindows.delete(ip);
}, Math.min(ORDER_RATE_WINDOW_MS, 10 * 60_000));
orderRateCleanup.unref?.();

app.get('/api/products', requireAdmin, async (_req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    return res.json({ products });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/products', requireAdmin, upload.array('mediaFiles', MAX_MEDIA_FILES), (req, res, next) => {
  createProduct(req, res, next, true);
});

app.put('/api/products/:id', requireAdmin, upload.array('mediaFiles', MAX_MEDIA_FILES), async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });

    const { name, description, category, price, stock } = req.body || {};
    if (!String(name || '').trim() || !String(category || '').trim() || price === undefined || price === '' || stock === undefined || stock === '') {
      return res.status(400).json({ success: false, message: 'Name, category, price, and stock are required.' });
    }
    const numericPrice = Number(price);
    const numericStock = Number(stock);
    if (!Number.isFinite(numericPrice) || numericPrice < 0 || !Number.isInteger(numericStock) || numericStock < 0) {
      return res.status(400).json({ success: false, message: 'Enter a valid price and whole-number stock quantity.' });
    }

    // Existing Cloudinary media is retained. New uploaded files are appended, up to the 10-file total.
    const currentMedia = Array.isArray(product.mediaFiles) ? product.mediaFiles.map(media =>
      typeof media === 'string' ? { path: media, mediaType: /\.(mp4|mov|avi|webm)(\?|$)/i.test(media) ? 'video' : 'image' } : media.toObject ? media.toObject() : media
    ) : [];
    if (!currentMedia.length && Array.isArray(product.media)) {
      product.media.forEach(url => currentMedia.push({ path: url, mediaType: /\.(mp4|mov|avi|webm)(\?|$)/i.test(String(url)) ? 'video' : 'image' }));
    }
    if (!currentMedia.length && product.imageUrl) {
      currentMedia.push({ path: product.imageUrl, mediaType: /\.(mp4|mov|avi|webm)(\?|$)/i.test(String(product.imageUrl)) ? 'video' : 'image' });
    }
    const addedMedia = uploadedMedia(req.files || []);
    if (currentMedia.length + addedMedia.length > MAX_MEDIA_FILES) {
      return res.status(400).json({ success: false, message: `A product can have at most ${MAX_MEDIA_FILES} media files total.` });
    }
    const mediaFiles = currentMedia.concat(addedMedia);
    const firstImage = mediaFiles.find(media => media.mediaType === 'image');
    product.name = String(name).trim();
    product.description = String(description || '').trim();
    product.category = String(category).trim();
    product.price = numericPrice;
    product.stock = numericStock;
    product.mediaFiles = mediaFiles;
    product.media = mediaFiles.map(media => media.path);
    product.imageUrl = firstImage ? firstImage.path : (mediaFiles[0]?.path || '');
    await product.save();
    return res.json({ success: true, message: 'Product updated successfully.', product });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/products/:id', requireAdmin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    return res.json({ success: true, message: 'Product deleted.' });
  } catch (error) {
    return next(error);
  }
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

app.use(express.static(PUBLIC_DIR, { index: false }));
app.use('/api', (_req, res) => jsonAuthFailure(res, 404, 'API endpoint not found.'));
app.use((_req, res) => res.status(404).send('Page not found.'));

app.use((error, _req, res, _next) => {
  console.error('Request error:', error);
  return res.status(500).json({ message: error.message || 'Server Error' });
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