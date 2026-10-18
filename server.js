const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const Product = require('./models/Product');

const app = express();

// Middleware for request data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// EJS view engine and views directory
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Multer Storage Configuration for HD Images & Videos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'public/uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB حد (ایچ ڈی ویڈیوز اور تصاویر کے لیے)
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('صرف تصاویر اور ویڈیوز کی اجازت ہے!'), false);
    }
  }
});

// Home page: always render the EJS template
app.get('/', async (req, res) => {
  try {
    const products = await Product.find().limit(12);
    res.render('index', { products });
  } catch (err) {
    console.error('Error loading homepage products:', err);
    res.status(500).render('index', { products: [] });
  }
});

// Route to handle new product creation with media upload
app.post('/add-product', upload.single('productMedia'), async (req, res) => {
  try {
    const { name, description, category, price, stock } = req.body;
    const mediaPath = req.file ? `/uploads/${req.file.filename}` : '';

    const newProduct = new Product({
      name,
      description,
      category,
      price: Number(price),
      stock: Number(stock || 0),
      imageUrl: mediaPath
    });

    await newProduct.save();
    res.redirect('/');
  } catch (err) {
    console.error('Error saving product:', err);
    res.status(500).send('Server Error');
  }
});

// Product detail page
app.get('/product/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).send('Product not found');
    }

    const related = await Product.find({
      _id: { $ne: product._id }
    }).limit(4);

    res.render('product', { product, related });
  } catch (err) {
    console.error('Error loading product:', err);
    res.status(500).send('Server Error');
  }
});

// Serve CSS, JavaScript, and images from public.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Connect to MongoDB, then start the server
const PORT = 5000;

mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/omnimart')
  .then(() => {
    console.log('MongoDB Connected Successfully');

    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB Connection Error:', err);
    process.exit(1);
  });