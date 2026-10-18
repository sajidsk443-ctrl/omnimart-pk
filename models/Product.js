const mongoose = require('mongoose');
const ProductSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  stock: { type: Number, default: 0, min: 0 },
  imageUrl: { type: String, default: '' },
  // Each entry keeps the public URL, original filename, media kind, and MIME type.
  mediaFiles: [{
    originalName: { type: String, required: true },
    filename: { type: String, required: true },
    path: { type: String, required: true },
    mimeType: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video'], required: true },
    size: { type: Number, required: true }
  }],
  // Simple URL list for clients that only need media paths.
  media: [{ type: String }],
  category: { type: String, default: 'General' },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model('Product', ProductSchema);
