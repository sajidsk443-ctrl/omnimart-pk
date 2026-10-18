const router = require('express').Router();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const auth = require('../middleware/auth');
const allow = require('../middleware/role');
const statuses = ['Pending','Confirmed','Packed','Shipped','Delivered','Cancelled'];

router.post('/', async (req, res) => {
  try {
    const { customerName, phone, address, city, items } = req.body;
    if (!customerName || !phone || !address || !city || !Array.isArray(items) || !items.length) return res.status(400).json({ message: 'Customer details and at least one item are required' });
    const orderItems = []; let total = 0;
    for (const item of items) {
      if (!mongoose.isValidObjectId(item.product) || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) return res.status(400).json({ message: 'Invalid product or quantity' });
      const product = await Product.findOne({ _id: item.product, active: true });
      if (!product) return res.status(404).json({ message: 'A product was not found' });
      if (product.stock < Number(item.quantity)) return res.status(400).json({ message: `Not enough stock for ${product.name}` });
      orderItems.push({ product: product._id, name: product.name, quantity: Number(item.quantity), unitPrice: product.price, seller: product.seller });
      total += product.price * Number(item.quantity);
    }
    const order = await Order.create({ customerName, phone, address, city, paymentMethod: 'COD', items: orderItems, total });
    for (const line of orderItems) await Product.updateOne({ _id: line.product }, { $inc: { stock: -line.quantity } });
    res.status(201).json({ message: 'COD order received', order });
  } catch (e) { res.status(500).json({ message: 'Could not create order' }); }
});
router.get('/', auth, allow('admin','seller'), async (req, res) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { 'items.seller': req.user._id };
    res.json(await Order.find(filter).populate('items.product', 'name').sort({ createdAt: -1 }));
  } catch (e) { res.status(500).json({ message: 'Could not load orders' }); }
});
router.patch('/:id/status', auth, allow('admin','seller'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!statuses.includes(status)) return res.status(400).json({ message: 'Invalid order status' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (req.user.role !== 'admin' && !order.items.some(i => String(i.seller) === String(req.user._id))) return res.status(403).json({ message: 'You cannot update this order' });
    order.status = status; await order.save(); res.json(order);
  } catch (e) { res.status(400).json({ message: 'Could not update order' }); }
});
module.exports = router;