const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const allow = require('../middleware/role');

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email });
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ message: 'Email or password is incorrect' });
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || 'development_only_change_me', { expiresIn: '12h' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (e) { res.status(500).json({ message: 'Login failed' }); }
});
router.get('/me', auth, (req, res) => res.json({ user: req.user }));
router.post('/sellers', auth, allow('admin'), async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password || String(password).length < 8) return res.status(400).json({ message: 'Name, email and password (8+ characters) are required' });
    const normalized = String(email).trim().toLowerCase();
    if (await User.findOne({ email: normalized })) return res.status(409).json({ message: 'Email already exists' });
    const seller = await User.create({ name, email: normalized, passwordHash: await bcrypt.hash(password, 12), role: 'seller' });
    res.status(201).json({ id: seller._id, name: seller.name, email: seller.email, role: seller.role });
  } catch (e) { res.status(500).json({ message: 'Could not create seller' }); }
});
module.exports = router;