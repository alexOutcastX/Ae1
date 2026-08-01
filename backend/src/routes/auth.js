import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { query, withTx, applyCredits } from '../db.js';
import { signToken, requireAuth } from '../auth.js';

const router = Router();
const SIGNUP_BONUS = parseInt(process.env.SIGNUP_BONUS || '10', 10);
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    credits: u.credits,
    isPremium: u.is_premium,
    premiumUntil: u.premium_until,
    streak: u.streak_count,
  };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, displayName } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rowCount > 0) return res.status(409).json({ error: 'email_taken' });

  const hash = await bcrypt.hash(password, 10);
  const user = await withTx(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO users (email, password_hash, display_name) VALUES ($1,$2,$3) RETURNING *',
      [email.toLowerCase(), hash, displayName || null]
    );
    const u = rows[0];
    u.credits = await applyCredits(client, u.id, SIGNUP_BONUS, 'signup');
    return u;
  });
  res.json({ token: signToken(user), user: publicUser(user) });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'invalid_input' });
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

// POST /api/auth/google  { idToken }
router.post('/google', async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'missing_id_token' });
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'invalid_google_token' });
  }

  const sub = payload.sub;
  const email = (payload.email || '').toLowerCase();
  const name = payload.name || null;

  const user = await withTx(async (client) => {
    let { rows } = await client.query(
      'SELECT * FROM users WHERE google_sub = $1 OR email = $2',
      [sub, email]
    );
    if (rows[0]) {
      // Link google_sub if this was previously an email account.
      const u = rows[0];
      if (!u.google_sub) {
        await client.query('UPDATE users SET google_sub = $1 WHERE id = $2', [sub, u.id]);
      }
      return u;
    }
    const created = await client.query(
      'INSERT INTO users (email, google_sub, display_name) VALUES ($1,$2,$3) RETURNING *',
      [email || null, sub, name]
    );
    const u = created.rows[0];
    u.credits = await applyCredits(client, u.id, SIGNUP_BONUS, 'signup');
    return u;
  });

  res.json({ token: signToken(user), user: publicUser(user) });
});

// GET /api/me
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json({ user: publicUser(rows[0]) });
});

// POST /api/me/fcm-token  { token }
router.post('/me/fcm-token', requireAuth, async (req, res) => {
  const { token } = req.body || {};
  await query('UPDATE users SET fcm_token = $1 WHERE id = $2', [token || null, req.userId]);
  res.json({ ok: true });
});

export default router;
export { publicUser };
