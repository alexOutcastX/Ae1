import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import creditRoutes from './routes/credits.js';
import paymentRoutes, { webhookHandler } from './routes/payments.js';

const app = express();
app.set('trust proxy', 1);

const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));

// Razorpay webhook needs the RAW body for signature verification — register it
// BEFORE the JSON parser so express doesn't consume the stream.
app.post('/api/payments/webhook', express.raw({ type: '*/*' }), webhookHandler);

app.use(express.json());

// Basic rate limiting on sensitive endpoints.
const tightLimiter = rateLimit({ windowMs: 60_000, max: 30 });
app.use('/api/auth', tightLimiter);
app.use('/api/credits', tightLimiter);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api', authRoutes); // exposes /api/me and /api/me/fcm-token
app.use('/api/credits', creditRoutes);
app.use('/api', creditRoutes); // exposes /api/tools/run
app.use('/api/payments', paymentRoutes);

// Fallback error handler.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

const port = parseInt(process.env.PORT || '3000', 10);
app.listen(port, () => console.log(`ProApp API listening on :${port}`));
