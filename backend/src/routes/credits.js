import { Router } from 'express';
import { query, withTx, applyCredits } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
const DAILY_BASE = parseInt(process.env.DAILY_BONUS_BASE || '5', 10);
const DAILY_MAX = parseInt(process.env.DAILY_BONUS_MAX || '15', 10);
const TOOL_COST = parseInt(process.env.TOOL_COST || '1', 10);
const SHARE_REWARD = parseInt(process.env.SHARE_REWARD || '2', 10);

// POST /api/credits/checkin — claim the daily sign-in bonus (idempotent per day).
router.post('/checkin', requireAuth, async (req, res) => {
  try {
    const result = await withTx(async (client) => {
      const { rows } = await client.query(
        'SELECT last_checkin, streak_count FROM users WHERE id = $1 FOR UPDATE',
        [req.userId]
      );
      const u = rows[0];
      const today = new Date().toISOString().slice(0, 10);
      const last = u.last_checkin ? new Date(u.last_checkin).toISOString().slice(0, 10) : null;

      if (last === today) {
        return { alreadyClaimed: true, credits: null, streak: u.streak_count, bonus: 0 };
      }

      // Continue the streak only if the last check-in was exactly yesterday.
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const newStreak = last === yesterday ? u.streak_count + 1 : 1;
      const bonus = Math.min(DAILY_BASE + (newStreak - 1), DAILY_MAX);

      await client.query(
        'UPDATE users SET last_checkin = $1, streak_count = $2 WHERE id = $3',
        [today, newStreak, req.userId]
      );
      const credits = await applyCredits(client, req.userId, bonus, 'daily_bonus');
      return { alreadyClaimed: false, credits, streak: newStreak, bonus };
    });
    res.json(result);
  } catch (err) {
    console.error('checkin error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/tools/run — run a tool; spends TOOL_COST credits unless premium.
router.post('/tools/run', requireAuth, async (req, res) => {
  const { tool = 'default', input } = req.body || {};
  try {
    const result = await withTx(async (client) => {
      const { rows } = await client.query(
        'SELECT credits, is_premium, premium_until FROM users WHERE id = $1 FOR UPDATE',
        [req.userId]
      );
      const u = rows[0];
      const premiumActive =
        u.is_premium && (!u.premium_until || new Date(u.premium_until) > new Date());

      if (!premiumActive) {
        if (u.credits < TOOL_COST) {
          return { error: 'insufficient_credits', credits: u.credits };
        }
        await applyCredits(client, req.userId, -TOOL_COST, 'spend', tool);
      }

      // ---- Do the actual work of your utility here ----
      // This is where a real tool would run (convert, scan, transform, ...).
      const output = runTool(tool, input);

      const balance = premiumActive ? u.credits : u.credits - TOOL_COST;
      return { ok: true, output, credits: balance, premium: premiumActive };
    });
    if (result.error) return res.status(402).json(result);
    res.json(result);
  } catch (err) {
    console.error('tools/run error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// POST /api/credits/share-reward — grant credits for a share, max once/day.
router.post('/share-reward', requireAuth, async (req, res) => {
  try {
    const result = await withTx(async (client) => {
      const { rows } = await client.query(
        'SELECT last_share_reward FROM users WHERE id = $1 FOR UPDATE',
        [req.userId]
      );
      const last = rows[0].last_share_reward;
      if (last && Date.now() - new Date(last).getTime() < 86400000) {
        return { rewarded: false, reason: 'already_today' };
      }
      await client.query('UPDATE users SET last_share_reward = now() WHERE id = $1', [req.userId]);
      const credits = await applyCredits(client, req.userId, SHARE_REWARD, 'share_reward');
      return { rewarded: true, bonus: SHARE_REWARD, credits };
    });
    res.json(result);
  } catch (err) {
    console.error('share-reward error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// Placeholder utility logic — replace with your real productivity feature.
function runTool(tool, input) {
  switch (tool) {
    case 'reverse':
      return typeof input === 'string' ? input.split('').reverse().join('') : null;
    case 'wordcount':
      return typeof input === 'string' ? input.trim().split(/\s+/).filter(Boolean).length : 0;
    default:
      return { message: `Ran tool "${tool}"`, input };
  }
}

export default router;
