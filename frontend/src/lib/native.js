// Thin wrappers around Capacitor native plugins with web fallbacks so the app
// still runs in a browser during development.
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { api } from './api.js';

const isNative = Capacitor.isNativePlatform();

// ---- Push notifications ----
export async function registerPush() {
  if (!isNative) return;
  const { PushNotifications } = await import('@capacitor/push-notifications');

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;

  PushNotifications.addListener('registration', async (token) => {
    try {
      await api('/api/me/fcm-token', { method: 'POST', body: { token: token.value } });
    } catch (e) {
      console.warn('fcm token save failed', e);
    }
  });
  PushNotifications.addListener('registrationError', (e) => console.warn('push reg error', e));
  await PushNotifications.register();
}

// ---- Native share (also grants a share reward server-side) ----
export async function shareApp() {
  const url = 'https://proapp.example.com/?ref=share';
  try {
    if (isNative) {
      await Share.share({
        title: 'ProApp',
        text: 'Check out ProApp — get free credits when you join!',
        url,
        dialogTitle: 'Share ProApp',
      });
    } else if (navigator.share) {
      await navigator.share({ title: 'ProApp', text: 'Check out ProApp!', url });
    } else {
      await navigator.clipboard.writeText(url);
    }
    // Reward the user for sharing (server rate-limits to once/day).
    try {
      return await api('/api/credits/share-reward', { method: 'POST' });
    } catch {
      return null;
    }
  } catch {
    return null; // user cancelled
  }
}

// ---- Google sign-in ----
export async function googleSignIn() {
  if (!isNative) throw new Error('Google sign-in runs on device only in this scaffold');
  const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
  await GoogleAuth.initialize();
  const result = await GoogleAuth.signIn();
  const idToken = result.authentication.idToken;
  return api('/api/auth/google', { method: 'POST', auth: false, body: { idToken } });
}
