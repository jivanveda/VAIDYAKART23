require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// ── MongoDB Connection ──────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ── Schemas ─────────────────────────────────────────────────────────────────
const orderSchema = new mongoose.Schema({
  name: String,
  phone: String,
  address: String,
  pincode: String,
  city: String,
  state: String,
  product: { type: String, default: 'AyurSlim Gold' },
  productName: { type: String, default: 'AyurSlim Gold — Ayurvedic Weight Management' },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  variant: { type: String, default: '1 Month Pack' },
  quantity: { type: Number, default: 1 },
  price: { type: Number, default: 799 },
  totalAmount: { type: Number, default: 799 },
  status: { type: String, enum: ['new', 'confirmed', 'shipped', 'delivered', 'cancelled'], default: 'new' },
  createdAt: { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
  name: String,
  description: String,
  price: Number,
  mrp: Number,
  images: [String],
  benefits: [String],
  ingredients: String,
  howToUse: String,
  variants: [{ label: String, price: Number }],
  stock: { type: Number, default: 100 },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const settingSchema = new mongoose.Schema({
  metaPixel: { type: String, default: '' }
});

const Order = mongoose.model('Order', orderSchema);
const Product = mongoose.model('Product', productSchema);
const Setting = mongoose.model('Setting', settingSchema);

// ── Live Visitors ────────────────────────────────────────────────────────────
const visitors = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of visitors) {
    if (now - ts > 60000) visitors.delete(id);
  }
}, 30000);

// ── ORDERS ───────────────────────────────────────────────────────────────────

// IMPORTANT: /export/csv MUST be before /:id routes
app.get('/api/orders/export/csv', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    const headers = ['OrderID', 'Name', 'Phone', 'Address', 'City', 'State', 'Pincode', 'Product', 'Variant', 'Qty', 'Price', 'Total', 'Status', 'Date'];
    const rows = orders.map(o => [
      o._id, o.name, o.phone, `"${(o.address || '').replace(/"/g, '""')}"`,
      o.city, o.state, o.pincode, o.productName || o.product,
      o.variant, o.quantity, o.price, o.totalAmount, o.status,
      new Date(o.createdAt).toISOString()
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const body = req.body;
    // Check duplicate phone
    const phone = (body.phone || '').trim();
    if (phone) {
      const existing = await Order.findOne({ phone });
      if (existing) {
        return res.status(409).json({ success: false, duplicate: true, error: 'Order with this phone already exists', existingOrderId: existing._id });
      }
    }
    const order = new Order({
      name: (body.name || '').trim(),
      phone: phone,
      address: (body.address || '').trim(),
      pincode: (body.pincode || '').trim(),
      city: (body.city || '').trim(),
      state: (body.state || '').trim(),
      product: body.product || 'AyurSlim Gold',
      productName: body.productName || 'AyurSlim Gold — Ayurvedic Weight Management',
      productId: body.productId || null,
      variant: body.variant || '1 Month Pack',
      quantity: body.quantity || 1,
      price: body.price || 799,
      totalAmount: body.totalAmount || 799,
      status: 'new'
    });
    await order.save();
    res.json({ success: true, orderId: order._id });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json({ success: true, order });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/orders/:id/address', async (req, res) => {
  try {
    const { name, address, city, state, pincode } = req.body;
    const update = {
      name: (name || '').trim(),
      address: (address || '').trim(),
      city: (city || '').trim(),
      state: (state || '').trim(),
      pincode: (pincode || '').trim()
    };
    const order = await Order.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    res.json({ success: true, order });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PRODUCTS ─────────────────────────────────────────────────────────────────

// IMPORTANT: /all MUST be before /:id
app.get('/api/products/all', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json({ success: true, products });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find({ active: true }).sort({ createdAt: -1 });
    res.json({ success: true, products });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const product = new Product(req.body);
    await product.save();
    res.json({ success: true, product });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
    res.json({ success: true, product });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── ADMIN ────────────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
      res.json({ success: true, token: 'vaidyakart_admin_' + Date.now() });
    } else {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/junk-clean', async (req, res) => {
  try {
    // 1. Expire stale visitors
    const now = Date.now();
    let visitorsCleared = 0;
    for (const [id, ts] of visitors) {
      if (now - ts > 60000) { visitors.delete(id); visitorsCleared++; }
    }
    // 2. Trim whitespace in orders
    const orders = await Order.find();
    let ordersFixed = 0;
    for (const order of orders) {
      let changed = false;
      for (const field of ['name', 'phone', 'address', 'city', 'state', 'pincode']) {
        if (typeof order[field] === 'string') {
          const trimmed = order[field].trim();
          if (trimmed !== order[field]) { order[field] = trimmed; changed = true; }
        }
      }
      if (changed) { await order.save(); ordersFixed++; }
    }
    // 3. Delete empty orders
    const del = await Order.deleteMany({ $or: [{ name: { $in: ['', null] } }, { phone: { $in: ['', null] } }], $and: [{ $or: [{ name: { $in: ['', null] } }] }, { $or: [{ phone: { $in: ['', null] } }] }] });
    const emptyOrders = await Order.countDocuments({ name: { $in: ['', null] }, phone: { $in: ['', null] } });
    const deleted = await Order.deleteMany({ name: { $in: ['', null] }, phone: { $in: ['', null] } });
    res.json({ success: true, visitorsCleared, ordersFixed, emptyOrders: deleted.deletedCount });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── STATS ────────────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const [total, newO, confirmed, shipped, delivered, revenueAgg] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: 'new' }),
      Order.countDocuments({ status: 'confirmed' }),
      Order.countDocuments({ status: 'shipped' }),
      Order.countDocuments({ status: 'delivered' }),
      Order.aggregate([{ $match: { status: { $in: ['confirmed', 'shipped', 'delivered'] } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }])
    ]);
    const revenue = revenueAgg[0]?.total || 0;
    res.json({ success: true, totalOrders: total, newOrders: newO, confirmedOrders: confirmed, shippedOrders: shipped, deliveredOrders: delivered, revenue });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── PINCODE ──────────────────────────────────────────────────────────────────
app.get('/api/pincode/:pin', async (req, res) => {
  try {
    const r = await fetch(`https://api.postalpincode.in/pincode/${req.params.pin}`);
    const data = await r.json();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── SEED ─────────────────────────────────────────────────────────────────────
app.post('/api/seed', async (req, res) => {
  try {
    const count = await Product.countDocuments();
    if (count > 0) return res.json({ success: true, message: 'Already seeded' });
    const product = new Product({
      name: 'AyurSlim Gold — Ayurvedic Weight Management Capsules',
      description: '100% natural Ayurvedic formula with time-tested herbs. Boosts metabolism, reduces stubborn fat, improves digestion, and enhances energy levels — without side effects.',
      price: 799, mrp: 1499,
      images: [
        'https://images.unsplash.com/photo-1611072172377-0cabc3adbe42?w=600',
        'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600'
      ],
      benefits: ['Boosts fat metabolism naturally', 'Reduces belly fat & love handles', 'Improves digestion & gut health', 'Detoxifies liver & blood', 'Increases energy & stamina', 'Balances stress hormones (cortisol)'],
      ingredients: 'Garcinia Cambogia (500mg), Triphala (200mg), Guggul Extract (150mg), Ashwagandha (100mg), Methi (Fenugreek) Seed (100mg), Vijaysar Extract (50mg)',
      howToUse: 'Take 2 capsules twice daily — 30 minutes before breakfast and dinner. Drink with lukewarm water. For best results, use for minimum 90 days with a balanced diet.',
      variants: [
        { label: '1 Month Pack (60 Capsules)', price: 799 },
        { label: '2 Month Pack (120 Capsules)', price: 1399 },
        { label: '3 Month Pack (180 Capsules) — Best Value', price: 1899 }
      ],
      stock: 247, active: true
    });
    await product.save();
    res.json({ success: true, product });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── META PIXEL ───────────────────────────────────────────────────────────────
app.get('/api/meta', async (req, res) => {
  try {
    const s = await Setting.findOne();
    res.json({ success: true, metaPixel: s?.metaPixel || '' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/meta', async (req, res) => {
  try {
    let s = await Setting.findOne();
    if (!s) s = new Setting();
    s.metaPixel = req.body.metaPixel || '';
    await s.save();
    res.json({ success: true, metaPixel: s.metaPixel });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── LIVE VISITORS ─────────────────────────────────────────────────────────────
app.post('/api/visitors/ping', (req, res) => {
  try {
    const { visitorId, action } = req.body;
    if (!visitorId) return res.json({ success: true, count: visitors.size });
    if (action === 'leave') visitors.delete(visitorId);
    else visitors.set(visitorId, Date.now());
    res.json({ success: true, count: visitors.size });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/visitors/count', (req, res) => {
  try {
    const now = Date.now();
    for (const [id, ts] of visitors) { if (now - ts > 60000) visitors.delete(id); }
    res.json({ success: true, count: visitors.size });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── SELLOSHIP ─────────────────────────────────────────────────────────────────
app.post('/api/selloship/create-shipment', async (req, res) => {
  try {
    const { apiKey, order } = req.body;
    const r = await fetch('https://api.selloship.com/api/v1/shipments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(order)
    });
    const data = await r.json();
    res.json({ success: true, awb: data.awb || data.tracking_number || null, raw: data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/selloship/account', async (req, res) => {
  try {
    const apiKey = req.headers['x-selloship-key'];
    const r = await fetch('https://api.selloship.com/api/v1/account', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    const data = await r.json();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 VaidyaKart server running on port ${PORT}`));
