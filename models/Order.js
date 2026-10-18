const mongoose = require('mongoose');
const OrderSchema = new mongoose.Schema({
  customerName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  paymentMethod: { type: String, enum: ['COD'], default: 'COD' },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String,
    quantity: { type: Number, min: 1, required: true },
    unitPrice: { type: Number, min: 0, required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  }],
  total: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['Pending','Confirmed','Packed','Shipped','Delivered','Cancelled'], default: 'Pending' }
}, { timestamps: true });
module.exports = mongoose.model('Order', OrderSchema);