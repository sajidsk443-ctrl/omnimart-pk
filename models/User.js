const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'seller'], default: 'seller' },
  active: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model('User', UserSchema);