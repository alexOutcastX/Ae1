# ProApp — Architecture & Deployment Plan

A cross-platform **Android app (Capacitor)** with a **self-hosted backend on your private cloud VM**, monetized through **premium unlock** and a **credits economy** (daily sign-in bonus + pay-to-refill via **Razorpay**), with **push notifications**, **native sharing**, and **social sign-in**.

Everything in the recommended stack is **free** except the VM you already own and Razorpay's per-transaction fee (charged only when you actually collect money).

---

## 1. Product model (Utility / Productivity)

The app is a "Pro Tools" utility. The core loop maps directly onto your monetization requirements:

- Each tool run **costs 1 credit** for free users.
- **Daily sign-in** grants bonus credits (streak-aware: more credits the longer the streak).
- Users can **buy credit packs** with Razorpay, or buy a **Premium unlock** (one-time or subscription) that removes the credit cost entirely and unlocks premium-only tools.
- **Share** and **social sign-in** drive growth; an optional "share to earn credits" hook is included.

This is deliberately generic so you can swap the actual utility (PDF tools, image tools, converters, a scanner, a tracker, etc.) without touching the monetization plumbing.

---

## 2. Stack (all free / open-source)

| Layer | Choice | Why | Cost |
|---|---|---|---|
| Mobile shell | **Capacitor 6** | Wrap a web app as a native Android app; native plugins for push/share | Free |
| Frontend | **React + Vite** | Fast, standard, small bundle | Free |
| Backend API | **Node.js + Express** | Runs free on your VM; huge ecosystem | Free |
| Database | **PostgreSQL 16** | Free, robust, transactional (critical for a credit ledger) | Free |
| Auth | **JWT** + **Google Sign-In** | Email/password + social login | Free |
| Payments | **Razorpay** | As you requested; Node SDK + webhooks | Free SDK, ~2% per txn |
| Push | **Firebase Cloud Messaging (FCM)** | Free unlimited push; `firebase-admin` on the server | Free |
| Sharing | **@capacitor/share** | Native Android share sheet | Free |
| Reverse proxy / TLS | **Nginx + Let's Encrypt (certbot)** | Free HTTPS on your VM | Free |
| Orchestration | **Docker Compose** | One command to run API + DB + Nginx on the VM | Free |

> **Free managed alternative:** If you'd rather not run a server, **Supabase** (free tier: Postgres + auth + storage + edge functions) can replace the Node backend + Postgres + FCM plumbing. The trade-off is less control and a usage ceiling on the free tier. The self-hosted stack above was chosen because you specified a private VM and "anything free" — your own VM is the cheapest, most controllable option.

---

## 3. Database schema

A credit balance must never drift, so credits live in an **append-only ledger** and the balance is derived/cached. Every spend/grant is one transactional row.

```
users
  id              uuid pk
  email           text unique
  password_hash   text            -- null for social-only accounts
  google_sub      text unique     -- Google subject id, null if not linked
  display_name    text
  credits         integer  default 0     -- cached balance (source of truth = ledger)
  is_premium      boolean  default false
  premium_until   timestamptz             -- null = lifetime/one-time; set for subscription
  fcm_token       text
  streak_count    integer  default 0
  last_checkin    date
  created_at      timestamptz default now()

credit_ledger        -- append-only; balance = sum(delta)
  id          bigserial pk
  user_id     uuid fk -> users
  delta       integer            -- +grant / -spend
  reason      text               -- 'daily_bonus' | 'spend' | 'purchase' | 'share_reward' | 'signup'
  ref         text               -- e.g. razorpay payment id or tool name
  created_at  timestamptz default now()

purchases
  id             uuid pk
  user_id        uuid fk -> users
  product        text            -- 'credits_100' | 'premium_lifetime' | 'premium_monthly'
  amount_paise   integer         -- Razorpay works in the smallest currency unit
  razorpay_order_id    text unique
  razorpay_payment_id  text
  status         text            -- 'created' | 'paid' | 'failed'
  created_at     timestamptz default now()
```

Migration file: `backend/src/migrations/001_init.sql`.

---

## 4. API design

All under `/api`. JWT in `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | email + password signup (grants signup credits) |
| POST | `/auth/login` | email + password login |
| POST | `/auth/google` | verify Google ID token, upsert user, return JWT |
| GET  | `/me` | profile: credits, premium status, streak |
| POST | `/me/fcm-token` | store device push token |
| POST | `/credits/checkin` | claim daily bonus (idempotent per day; streak logic) |
| POST | `/tools/run` | spend 1 credit (skipped if premium) and return a result |
| POST | `/credits/share-reward` | grant credits for a verified share (rate-limited) |
| POST | `/payments/order` | create a Razorpay order for a product |
| POST | `/payments/verify` | verify checkout signature client-side callback |
| POST | `/payments/webhook` | **authoritative** Razorpay webhook → grant credits / premium |

**Money-safety rule:** credits/premium are only granted from the **server-verified webhook** (and signature-verified `/verify`), never from a client claiming "I paid."

---

## 5. Credits & premium economy (defaults — tune freely)

- Signup bonus: **10 credits**
- Daily check-in: **5 credits**, +1 per streak day up to **15** (streak resets if a day is missed)
- Tool run cost: **1 credit** (free & unlimited for premium)
- Credit packs: 100 / 500 / 1200 credits (₹99 / ₹399 / ₹799 — example)
- Premium: **₹299 lifetime** or **₹99/month** — removes credit cost, unlocks premium tools
- Share reward: **+2 credits**, max once/day (anti-abuse via `last` timestamp)

---

## 6. Razorpay flow

1. App calls `POST /payments/order` with a product id → server creates a Razorpay **order** (amount from a server-side price table, never trusted from the client) and returns `order_id` + your **public key**.
2. App opens **Razorpay Checkout** with that order.
3. On success Razorpay returns `payment_id` + `signature`; app posts them to `/payments/verify`, which recomputes `HMAC_SHA256(order_id|payment_id, key_secret)` and compares.
4. Independently, Razorpay calls your **`/payments/webhook`** (verified with the webhook secret). This is the source of truth that flips `is_premium` / credits the purchase, wrapped in a DB transaction so it's idempotent.

---

## 7. Push, sharing, social

- **Push:** `@capacitor/push-notifications` registers the device, sends the FCM token to `/me/fcm-token`. The server sends campaigns/transactional pushes via `firebase-admin`. Use it for "your daily bonus is ready" re-engagement.
- **Sharing:** `@capacitor/share` opens the native share sheet with a deep link / referral URL.
- **Social sign-in:** Google ID token verified server-side (`google-auth-library`). Structure supports adding Facebook/Apple later the same way.

---

## 8. Deployment on your VM (free)

```
Internet ──443──> Nginx (TLS via certbot) ──> Node API :3000
                                          └──> Postgres :5432 (internal only)
```

One `docker compose up -d` brings up Postgres, the Node API, and Nginx. Certbot issues free TLS. Full step-by-step is in `README.md` (server prep, DNS, TLS, env secrets, running migrations, building the Android APK/AAB, and wiring FCM + Razorpay keys).

---

## 9. What's in the scaffold

- `backend/` — Express API implementing every endpoint above, JWT + Google auth, transactional credit ledger, daily-bonus streak logic, Razorpay order/verify/webhook, FCM sender, SQL migration.
- `frontend/` — Capacitor + React app: login/signup + Google, home tool that spends credits, daily bonus card, premium paywall with Razorpay checkout, push registration, native share.
- `docker-compose.yml`, `nginx/`, `Dockerfile`, `.env.example` files, and `README.md` deploy guide.

## 10. Security & production checklist

- Set strong `JWT_SECRET`, DB password, and Razorpay/FCM secrets via `.env` (never commit them).
- Serve only over HTTPS; HSTS on in Nginx.
- Rate-limit auth, check-in, share-reward, and tool endpoints.
- Grant money-backed benefits **only** from verified webhook/signature.
- Back up Postgres (`pg_dump` cron) and keep the volume off the app container.
- Before Play Store release: privacy policy, data-safety form, and (for paid digital goods) confirm Razorpay vs. Google Play Billing policy for your app category/region.
