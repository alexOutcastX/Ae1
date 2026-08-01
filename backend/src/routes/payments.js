import { Router } from 'express';
import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { query, withTx, applyCredits } from '../db.js';
import { requireAuth } from '../auth.js';
import { getProduct } from '../catalog.js';

const router = Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// POST /api/payments/order  { product }
// Creates a Razorpay order using a server-side price. Returns order + public key.
router.post('/order', requireAuth, async (req, res) => {
  const { product } = req.body || {};
  const p = getProduct(product);
  if (!p) return res.status(400).json({ error: 'unknown_product' });

  try {
    const order = await razorpay.orders.create({
      amount: p.amount_paise,
      currency: 'INR',
      notes: { userId: req.userId, product },
    });
    await query(
      `INSERT INTO purchases (user_id, product, amount_paise, razorpay_order_id, status)
       VALUES ($1,$2,$3,$4,'created')`,
      [req.userId, product, p.amount_paise, order.id]
    );
    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      product,
      label: p.label,
    });
  } catch (err) {
    console.error('order error', err);
    res.status(502).json({ error: 'razorpay_error' });
  }
});

// POST /api/payments/verify  { orderId, paymentId, signature }
// Client callback right after checkout. Verifies the signature and fulfils.
router.post('/verify', requireAuth, async (req, res) => {
  const { orderId, paymentId, signature } = req.body || {};
  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  if (expected !== signature) return res.status(400).json({ error: 'bad_signature' });

  try {
    const outcome = await fulfilOrder(orderId, paymentId);
    res.json({ ok: true, ...outcome });
  } catch (err) {
    console.error('verify error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/payments/webhook  — authoritative fulfilment from Razorpay.
// Mounted with a raw body parser in index.js so we can verify the signature.
export async function webhookHandler(req, res) {
  const signature = req.headers['x-razorpay-signature'];
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(req.body) // raw Buffer
    .digest('hex');
  if (signature !== expected) return res.status(400).send('bad signature');

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).send('bad payload');
  }

  try {
    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      await fulfilOrder(payment.order_id, payment.id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('webhook error', err);
    res.status(500).send('error');
  }
}

// Idempotent fulfilment: only acts when the purchase is still 'created'.
async function fulfilOrder(orderId, paymentId) {
  return withTx(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM purchases WHERE razorpay_order_id = $1 FOR UPDATE',
      [orderId]
    );
    const purchase = rows[0];
    if (!purchase) return { status: 'unknown_order' };
    if (purchase.status === 'paid') return { status: 'already_paid' };

    const p = getProduct(purchase.product);
    await client.query(
      "UPDATE purchases SET status = 'paid', razorpay_payment_id = $2 WHERE id = $1",
      [purchase.id, paymentId]
    );

    if (p.type === 'credits') {
      const credits = await applyCredits(client, purchase.user_id, p.credits, 'purchase', paymentId);
      return { status: 'paid', granted: 'credits', credits };
    }
    // premium
    if (p.months === null) {
      await client.query(
        'UPDATE users SET is_premium = true, premium_until = NULL WHERE id = $1',
        [purchase.user_id]
      );
    } else {
      await client.query(
        `UPDATE users SET is_premium = true,
           premium_until = GREATEST(COALESCE(premium_until, now()), now()) + ($2 || ' months')::interval
         WHERE id = $1`,
        [purchase.user_id, p.months]
      );
    }
    return { status: 'paid', granted: 'premium' };
  });
}

export default router;
