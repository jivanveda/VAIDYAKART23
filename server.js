require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ── Schemas ───────────────────────────────────────────────────────────────
const orderSchema = new mongoose.Schema({
  name:        { type: String, default: '' },
  phone:       { type: String, default: '' },
  address:     { type: String, default: '' },
  pincode:     { type: String, default: '' },
  city:        { type: String, default: '' },
  state:       { type: String, default: '' },
  product:     { type: String, default: 'AyurSlim Gold' },
  productName: { type: String, default: 'AyurSlim Gold — Ayurvedic Weight Management' },
  productId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  variant:     { type: String, default: '1 Month Pack' },
  quantity:    { type: Number, default: 1 },
  price:       { type: Number, default: 799 },
  totalAmount: { type: Number, default: 799 },
  status:      { type: String, enum: ['new','confirmed','shipped','delivered','cancelled'], default: 'new' },
  createdAt:   { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
  name: String, description: String, price: Number, mrp: Number,
  images: [String], benefits: [String], ingredients: String,
  howToUse: String, variants: [{ label: String, price: Number }],
  stock: { type: Number, default: 100 },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const settingSchema = new mongoose.Schema({ metaPixel: { type: String, default: '' } });

// ── VISITOR SCHEMA (persistent — survives server restarts) ─────────────────
const visitorSchema = new mongoose.Schema({
  visitorId: { type: String, required: true, unique: true },
  lastSeen:  { type: Date, default: Date.now }
});
visitorSchema.index({ lastSeen: 1 }, { expireAfterSeconds: 300 }); // auto-delete after 5 min

const Order   = mongoose.model('Order',   orderSchema);
const Product = mongoose.model('Product', productSchema);
const Setting = mongoose.model('Setting', settingSchema);
const Visitor = mongoose.model('Visitor', visitorSchema);

// ── Clean stale visitors every 60s ────────────────────────────────────────
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - 90000); // 90s timeout
    await Visitor.deleteMany({ lastSeen: { $lt: cutoff } });
  } catch {}
}, 60000);

// ═══════════════════════════════════════════════════════════════════════════
// ORDERS — /export/csv BEFORE /:id
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/orders/export/csv', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    const esc = s => `"${(s||'').replace(/"/g,'""')}"`;
    const headers = ['OrderID','Name','Phone','Address','City','State','Pincode','Product','Variant','Qty','Price','Total','Status','Date'];
    const rows = orders.map(o => [o._id, esc(o.name), o.phone, esc(o.address), o.city, o.state, o.pincode, esc(o.productName||o.product), esc(o.variant), o.quantity, o.price, o.totalAmount, o.status, new Date(o.createdAt).toISOString()]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="vaidyakart-orders.csv"');
    res.send(csv);
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const b = req.body;
    const phone = (b.phone || '').trim();
    if (phone) {
      const existing = await Order.findOne({ phone });
      if (existing) return res.status(409).json({ success:false, duplicate:true, error:'Duplicate phone', existingOrderId:existing._id });
    }
    const order = new Order({
      name:(b.name||'').trim(), phone,
      address:(b.address||'').trim(), pincode:(b.pincode||'').trim(),
      city:(b.city||'').trim(), state:(b.state||'').trim(),
      product:b.product||'AyurSlim Gold', productName:b.productName||'AyurSlim Gold — Ayurvedic Weight Management',
      productId:b.productId||null, variant:b.variant||'1 Month Pack',
      quantity:b.quantity||1, price:b.price||799, totalAmount:b.totalAmount||799
    });
    await order.save();
    res.json({ success:true, orderId:order._id });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json({ success:true, orders });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

// Bulk status update
app.post('/api/orders/bulk-status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!ids || !ids.length || !status) return res.status(400).json({ success:false, error:'ids and status required' });
    await Order.updateMany({ _id: { $in: ids } }, { status });
    res.json({ success:true, updated:ids.length });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new:true });
    if (!order) return res.status(404).json({ success:false, error:'Not found' });
    res.json({ success:true, order });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.put('/api/orders/:id/address', async (req, res) => {
  try {
    const { name, address, city, state, pincode } = req.body;
    const update = { name:(name||'').trim(), address:(address||'').trim(), city:(city||'').trim(), state:(state||'').trim(), pincode:(pincode||'').trim() };
    const order = await Order.findByIdAndUpdate(req.params.id, update, { new:true });
    if (!order) return res.status(404).json({ success:false, error:'Not found' });
    res.json({ success:true, order });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ success:true });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTS — /all BEFORE /:id
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/products/all', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json({ success:true, products });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find({ active:true }).sort({ createdAt: -1 });
    res.json({ success:true, products });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/products', async (req, res) => {
  try {
    const product = new Product(req.body);
    await product.save();
    res.json({ success:true, product });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { _id, __v, createdAt, ...updateData } = req.body;
    const product = await Product.findByIdAndUpdate(req.params.id, updateData, { new:true, runValidators:true });
    if (!product) return res.status(404).json({ success:false, error:'Not found' });
    res.json({ success:true, product });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success:true });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── ADMIN ─────────────────────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS)
      return res.json({ success:true, token:'vaidyakart_admin_'+Date.now() });
    res.status(401).json({ success:false, error:'Invalid credentials' });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/admin/junk-clean', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 90000);
    const vDel = await Visitor.deleteMany({ lastSeen: { $lt: cutoff } });
    const orders = await Order.find();
    let ordersFixed = 0;
    for (const o of orders) {
      let changed = false;
      for (const f of ['name','phone','address','city','state','pincode']) {
        if (typeof o[f]==='string' && o[f]!==o[f].trim()) { o[f]=o[f].trim(); changed=true; }
      }
      if (changed) { await o.save(); ordersFixed++; }
    }
    const deleted = await Order.deleteMany({ $and:[{$or:[{name:''},{name:null}]},{$or:[{phone:''},{phone:null}]}] });
    res.json({ success:true, visitorsCleared:vDel.deletedCount, ordersFixed, emptyOrders:deleted.deletedCount });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── STATS ─────────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const [total,newO,confirmed,shipped,delivered,revenueAgg] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({status:'new'}),
      Order.countDocuments({status:'confirmed'}),
      Order.countDocuments({status:'shipped'}),
      Order.countDocuments({status:'delivered'}),
      Order.aggregate([{$match:{status:{$in:['confirmed','shipped','delivered']}}},{$group:{_id:null,total:{$sum:'$totalAmount'}}}])
    ]);
    res.json({ success:true, totalOrders:total, newOrders:newO, confirmedOrders:confirmed, shippedOrders:shipped, deliveredOrders:delivered, revenue:revenueAgg[0]?.total||0 });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── PINCODE ───────────────────────────────────────────────────────────────
app.get('/api/pincode/:pin', async (req, res) => {
  try {
    const r = await fetch(`https://api.postalpincode.in/pincode/${req.params.pin}`);
    const data = await r.json();
    res.json({ success:true, data });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── SEED ──────────────────────────────────────────────────────────────────
app.post('/api/seed', async (req, res) => {
  try {
    const count = await Product.countDocuments();
    if (count > 0) return res.json({ success:true, message:'Already seeded' });
    const product = new Product({
      name:'AyurSlim Gold — Ayurvedic Weight Management Capsules',
      description:'100% natural Ayurvedic formula with time-tested herbs. Boosts metabolism, reduces stubborn fat, improves digestion, and enhances energy levels — without side effects.',
      price:799, mrp:1499,
      images:['https://images.unsplash.com/photo-1611072172377-0cabc3adbe42?w=600','https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=600'],
      benefits:['Boosts fat metabolism naturally','Reduces belly fat & love handles','Improves digestion & gut health','Detoxifies liver & blood','Increases energy & stamina','Balances stress hormones (cortisol)'],
      ingredients:'Garcinia Cambogia (500mg), Triphala (200mg), Guggul Extract (150mg), Ashwagandha (100mg), Methi (Fenugreek) Seed (100mg), Vijaysar Extract (50mg)',
      howToUse:'Take 2 capsules twice daily — 30 minutes before breakfast and dinner. Drink with lukewarm water.',
      variants:[{label:'1 Month Pack (60 Capsules)',price:799},{label:'2 Month Pack (120 Capsules)',price:1399},{label:'3 Month Pack (180 Capsules) — Best Value',price:1899}],
      stock:247, active:true
    });
    await product.save();
    res.json({ success:true, product });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── META PIXEL ────────────────────────────────────────────────────────────
app.get('/api/meta', async (req, res) => {
  try {
    const s = await Setting.findOne();
    res.json({ success:true, metaPixel:s?.metaPixel||'' });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.post('/api/meta', async (req, res) => {
  try {
    let s = await Setting.findOne();
    if (!s) s = new Setting();
    s.metaPixel = req.body.metaPixel||'';
    await s.save();
    res.json({ success:true, metaPixel:s.metaPixel });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── VISITORS (persistent in MongoDB — survives restarts) ──────────────────
app.post('/api/visitors/ping', async (req, res) => {
  try {
    const { visitorId, action } = req.body;
    if (!visitorId) {
      const count = await Visitor.countDocuments({ lastSeen: { $gt: new Date(Date.now()-90000) } });
      return res.json({ success:true, count });
    }
    if (action === 'leave') {
      await Visitor.deleteOne({ visitorId });
    } else {
      await Visitor.findOneAndUpdate({ visitorId }, { lastSeen: new Date() }, { upsert:true, new:true });
    }
    const count = await Visitor.countDocuments({ lastSeen: { $gt: new Date(Date.now()-90000) } });
    res.json({ success:true, count });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/visitors/count', async (req, res) => {
  try {
    const count = await Visitor.countDocuments({ lastSeen: { $gt: new Date(Date.now()-90000) } });
    res.json({ success:true, count });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

// ── SELLOSHIP ─────────────────────────────────────────────────────────────
app.post('/api/selloship/create-shipment', async (req, res) => {
  try {
    const { apiKey, order } = req.body;
    const r = await fetch('https://api.selloship.com/api/v1/shipments', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`}, body:JSON.stringify(order) });
    const data = await r.json();
    res.json({ success:true, awb:data.awb||data.tracking_number||null, raw:data });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

app.get('/api/selloship/account', async (req, res) => {
  try {
    const r = await fetch('https://api.selloship.com/api/v1/account', { headers:{'Authorization':`Bearer ${req.headers['x-selloship-key']}`} });
    const data = await r.json();
    res.json({ success:true, data });
  } catch (e) { res.status(500).json({ success:false, error:e.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 VaidyaKart running on port ${PORT}`));
