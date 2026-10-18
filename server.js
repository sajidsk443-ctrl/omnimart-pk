const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const Product = require('./models/Product');

const app = express();

// Middleware for request data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// EJS view engine and views directory
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
// Disabling the default index file prevents public/index.html from handling "/".
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