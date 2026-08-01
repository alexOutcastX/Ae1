# ProApp

A Capacitor Android app + self-hosted Node/Postgres backend with a credits economy, daily sign-in bonus, premium unlock, **Razorpay** payments, **FCM** push, native sharing, and Google sign-in. See `PLAN.md` for the full architecture.

```
proapp/
├── PLAN.md                # architecture & economy design
├── docker-compose.yml     # Postgres + API + Nginx
├── nginx/nginx.conf       # TLS reverse proxy
├── backend/               # Node + Express API
│   └── src/
│       ├── index.js            # app + routes wiring (raw body for webhook)
│       ├── db.js               # pg pool + transactional credit ledger
│       ├── auth.js             # JWT + requireAuth middleware
│       ├── catalog.js          # server-side price table
│       ├── migrate.js          # runs migrations/*.sql
│       ├── routes/             # auth, credits, payments
│       ├── services/push.js    # FCM sender
│       └── migrations/001_init.sql
└── frontend/              # Capacitor + React (Vite)
    └── src/
        ├── App.jsx             # auth + home + paywall UI
        └── lib/                # api, native plugins, razorpay checkout
```

---

## A. Backend on your VM (free)

Prereqs on the VM: Docker + Docker Compose, a domain pointing at the VM (e.g. `api.yourdomain.com`), ports 80/443 open.

```bash
# 1. Copy the project to the VM, then configure secrets
cp .env.example .env                      # postgres creds
cp backend/.env.example backend/.env      # API secrets (JWT, Razorpay, Google, FCM)
#   -> edit both files. Set a long JWT_SECRET and a strong POSTGRES_PASSWORD.
#   -> make DATABASE_URL match POSTGRES_* (host is "db").

# 2. (Optional push) put your Firebase service account here:
mkdir -p secrets && cp ~/firebase-service-account.json secrets/
#   and set FIREBASE_SERVICE_ACCOUNT=/app/secrets/firebase-service-account.json in backend/.env

# 3. Build & start
docker compose up -d --build

# 4. Run DB migrations (once)
docker compose exec api node src/migrate.js

# 5. Health check
curl http://localhost:3000/health   # {"ok":true}  (inside the VM)
```

### TLS with Let's Encrypt (free)
Edit `nginx/nginx.conf` and replace `api.yourdomain.com` with your domain, then issue certs:

```bash
mkdir -p certbot/conf certbot/www
docker run --rm -v $PWD/certbot/conf:/etc/letsencrypt -v $PWD/certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot -d api.yourdomain.com
docker compose restart nginx
```
Add a cron job to run `certbot renew` monthly.

---

## B. Razorpay setup

1. Create a Razorpay account → **Settings → API Keys** → copy `key_id` / `key_secret` into `backend/.env`.
2. **Settings → Webhooks** → add `https://api.yourdomain.com/api/payments/webhook`, select the `payment.captured` event, set a secret, and put that secret in `RAZORPAY_WEBHOOK_SECRET`.
3. Prices live server-side in `backend/src/catalog.js` — edit amounts there (in paise). The client can never change the price.
4. Test with Razorpay **test keys** first (`rzp_test_...`).

> **Play Store note:** For digital goods sold inside an Android app, Google Play's billing policy may require Google Play Billing rather than a third-party gateway in some regions/categories. Confirm your app's eligibility before publishing; the credit ledger/premium flags work identically whichever gateway grants them.

---

## C. Push (FCM) & Google sign-in setup

1. Create a Firebase project → add an **Android app** with package `com.proapp.app` → download `google-services.json` into `android/app/` after you add the Android platform (step D).
2. **Project settings → Service accounts → Generate new private key** → save as `secrets/firebase-service-account.json` for the backend.
3. **Google sign-in:** in Google Cloud console create an **OAuth Web client ID**; put it in `backend/.env` (`GOOGLE_CLIENT_ID`) and in `frontend/capacitor.config.json` (`serverClientId`). Add an **Android OAuth client** with your app's SHA-1.

---

## D. Build the Android app

```bash
cd frontend
npm install

# Point the app at your API (build-time env):
echo "VITE_API_BASE=https://api.yourdomain.com" > .env

npm run build          # produces dist/
npx cap add android    # first time only
npx cap sync android
npx cap open android   # opens Android Studio -> Run / build APK/AAB
```

For the **emulator** during local dev, set `VITE_API_BASE=http://10.0.2.2:3000` and run the backend locally (`cd backend && npm install && npm run dev` after `docker compose up -d db` + migrate).

Copy `google-services.json` into `android/app/` before building so push works.

---

## E. Endpoints quick reference

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` \| `/api/auth/login` \| `/api/auth/google` | returns `{token, user}` |
| GET  | `/api/me` | profile |
| POST | `/api/me/fcm-token` | save push token |
| POST | `/api/credits/checkin` | daily bonus (streak) |
| POST | `/api/tools/run` | spends 1 credit unless premium |
| POST | `/api/credits/share-reward` | +credits once/day |
| POST | `/api/payments/order` \| `/verify` \| `/webhook` | Razorpay |

---

## G. Getting the APK (GitHub Actions — no local Android Studio needed)

The repo ships with a CI workflow at `.github/workflows/android.yml` that builds a **debug APK** on GitHub's servers every time you push to `main` (or run it manually).

1. Push this project to GitHub (see below).
2. Open the repo's **Actions** tab → the **Build Android APK** run.
3. When it finishes (green check), download the APK from the run's **Artifacts** → `app-debug-apk`.
4. To get a shareable download, publish a **Release** — the workflow attaches the APK to it automatically.

Install the `.apk` on any Android phone (enable "Install unknown apps" for your browser/file manager). This build has push disabled until you add `google-services.json` (see section C); everything else works against your deployed API.

### Pushing to GitHub

```bash
# from the project root, remote is already set to your repo
git push origin main
```

If the push is rejected because the remote has other commits, run
`git pull --rebase origin main` first, then push again.

## F. Customising for your utility

Replace the placeholder `runTool()` in `backend/src/routes/credits.js` and the "Word counter" card in `frontend/src/App.jsx` with your real productivity feature. Everything else — credits, streaks, premium gating, payments, push — stays the same.
