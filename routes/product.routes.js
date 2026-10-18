const router = require('express').Router();
const Product = require('../models/Product');
const auth = require('../middleware/auth');
const allow = require('../middleware/role');

router.get('/', async (req, res) => {
  try {
    const filter = req.query.all === 'true' ? {} : { active: true };
    res.json(await Product.find(filter).populate('seller', 'name email').sort({ createdAt: -1 }));
  } catch (e) { res.status(500).json({ message: 'Could not load products' }); }
});
router.post('/', auth, allow('admin','seller'), async (req, res) => {
  try {
    const { name, description = '', price, stock = 0, imageUrl = '', category = 'General' } = req.body;
    if (!name || !Number.isFinite(Number(price)) || Number(price) < 0) return res.status(400).json({ message: 'Product name and valid price are required' });
    const product = await Product.create({ name, description, price: Number(price), stock: Math.max(0, Number(stock) || 0), imageUrl, category, seller: req.user.role === 'admin' && req.body.sellerId ? req.body.sellerId : req.user._id });
    res.status(201).json(product);
  } catch (e) { res.status(500).json({ message: 'Could not create product' }); }
});
router.patch('/:id', auth, allow('admin','seller'), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    if (req.user.role !== 'admin' && String(product.seller) !== String(req.user._id)) return res.status(403).json({ message: 'You can only edit your own products' });
    for (const key of ['name','description','price','stock','imageUrl','category','active']) if (req.body[key] !== undefined) product[key] = req.body[key];
    await product.save(); res.json(product);
  } catch (e) { res.status(400).json({ message: 'Could not update product' }); }
});
router.delete('/:id', auth, allow('admin','seller'), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    if (req.user.role !== 'admin' && String(product.seller) !== String(req.user._id)) return res.status(403).json({ message: 'You can only delete your own products' });
    await product.deleteOne(); res.json({ message: 'Product deleted' });
  } catch (e) { res.status(400).json({ message: 'Could not delete product' }); }
});
module.exports = router;