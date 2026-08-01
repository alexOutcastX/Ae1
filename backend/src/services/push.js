// Firebase Cloud Messaging sender. Push is optional: if no service account is
// configured the module no-ops so the rest of the API still runs.
import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';

let enabled = false;

try {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (path) {
    const serviceAccount = JSON.parse(readFileSync(path, 'utf8'));
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    enabled = true;
    console.log('[push] FCM initialised');
  } else {
    console.log('[push] FIREBASE_SERVICE_ACCOUNT not set — push disabled');
  }
} catch (err) {
  console.warn('[push] init failed, push disabled:', err.message);
}

// Send a notification to a single device token. Returns true on success.
export async function sendPush(fcmToken, title, body, data = {}) {
  if (!enabled || !fcmToken) return false;
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high' },
    });
    return true;
  } catch (err) {
    console.warn('[push] send failed:', err.message);
    return false;
  }
}
