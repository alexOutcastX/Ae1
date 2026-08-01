import { Preferences } from '@capacitor/preferences';

// Point this at your VM's API. For local dev use http://10.0.2.2:3000 on the
// Android emulator (that's the host machine). In production use https://api.yourdomain.com
export const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.yourdomain.com';

let cachedToken = null;

export async function getToken() {
  if (cachedToken) return cachedToken;
  const { value } = await Preferences.get({ key: 'token' });
  cachedToken = value;
  return value;
}

export async function setToken(token) {
  cachedToken = token;
  await Preferences.set({ key: 'token', value: token });
}

export async function clearToken() {
  cachedToken = null;
  await Preferences.remove({ key: 'token' });
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'request_failed'), { data, status: res.status });
  return data;
}
