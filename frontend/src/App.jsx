import React, { useEffect, useState } from 'react';
import { api, setToken, clearToken, getToken } from './lib/api.js';
import { registerPush, shareApp, googleSignIn } from './lib/native.js';
import { buyProduct } from './lib/razorpay.js';

const CREDIT_PACKS = [
  { id: 'credits_100', label: '100', price: '₹99' },
  { id: 'credits_500', label: '500', price: '₹399' },
  { id: 'credits_1200', label: '1200', price: '₹799' },
];

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  async function refreshMe() {
    try {
      const { user } = await api('/api/me');
      setUser(user);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    (async () => {
      if (await getToken()) await refreshMe();
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (user) registerPush().catch(() => {});
  }, [user?.id]);

  async function onAuthSuccess(data) {
    await setToken(data.token);
    setUser(data.user);
  }

  async function logout() {
    await clearToken();
    setUser(null);
  }

  if (loading) return <div className="app"><p className="muted">Loading…</p></div>;

  return (
    <div className="app">
      {!user ? (
        <AuthScreen onSuccess={onAuthSuccess} flash={flash} />
      ) : (
        <Home user={user} setUser={setUser} refreshMe={refreshMe} logout={logout} flash={flash} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function AuthScreen({ onSuccess, flash }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const data = await api(`/api/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST', auth: false, body: { email, password },
      });
      await onSuccess(data);
    } catch (e) {
      flash(e.data?.error === 'email_taken' ? 'Email already registered' : 'Auth failed');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    try {
      const data = await googleSignIn();
      await onSuccess(data);
    } catch (e) {
      flash('Google sign-in unavailable here');
    }
  }

  return (
    <div>
      <h1>ProApp</h1>
      <p className="muted">Your pro productivity toolkit.</p>
      <div className="card">
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button disabled={busy} onClick={submit}>{mode === 'login' ? 'Log in' : 'Create account'}</button>
        <div style={{ height: 8 }} />
        <button className="secondary" onClick={google}>Continue with Google</button>
        <p className="small muted" style={{ marginTop: 14, textAlign: 'center' }}>
          {mode === 'login' ? "No account?" : 'Already have one?'}{' '}
          <button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </p>
      </div>
    </div>
  );
}

function Home({ user, setUser, refreshMe, logout, flash }) {
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState(null);
  const premiumActive = user.isPremium && (!user.premiumUntil || new Date(user.premiumUntil) > new Date());

  async function checkin() {
    setBusy(true);
    try {
      const r = await api('/api/credits/checkin', { method: 'POST' });
      if (r.alreadyClaimed) flash('Already claimed today');
      else { setUser({ ...user, credits: r.credits, streak: r.streak }); flash(`+${r.bonus} credits! Streak ${r.streak}`); }
    } catch { flash('Check-in failed'); }
    finally { setBusy(false); }
  }

  async function runTool() {
    setBusy(true);
    try {
      const r = await api('/api/tools/run', { method: 'POST', body: { tool: 'wordcount', input } });
      setOutput(r.output);
      setUser({ ...user, credits: r.credits });
    } catch (e) {
      if (e.data?.error === 'insufficient_credits') flash('Out of credits — grab a pack or go Premium');
      else flash('Tool failed');
    } finally { setBusy(false); }
  }

  async function share() {
    const r = await shareApp();
    if (r?.rewarded) { setUser({ ...user, credits: r.credits }); flash(`Thanks! +${r.bonus} credits`); }
  }

  async function buy(product) {
    try {
      await buyProduct(product, user);
      await refreshMe();
      flash('Purchase successful!');
    } catch (e) {
      if (e.message !== 'payment_cancelled') flash('Payment failed');
    }
  }

  return (
    <div>
      <div className="row">
        <h1>Hi{user.displayName ? `, ${user.displayName}` : ''} 👋</h1>
        <button className="link" onClick={logout}>Log out</button>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <div className="muted">Credits</div>
            <div className="balance">{user.credits}</div>
          </div>
          {premiumActive && <span className="badge">PREMIUM</span>}
        </div>
        <div style={{ height: 10 }} />
        <div className="row" style={{ gap: 10 }}>
          <button className="secondary" disabled={busy} onClick={checkin}>Daily bonus</button>
          <button className="ghost" onClick={share}>Share &amp; earn</button>
        </div>
      </div>

      <div className="card">
        <b>Word counter</b>
        <p className="muted small">Each run costs 1 credit{premiumActive ? ' (free on Premium)' : ''}.</p>
        <input placeholder="Type or paste text…" value={input} onChange={(e) => setInput(e.target.value)} />
        <button disabled={busy} onClick={runTool}>Run tool</button>
        {output != null && <p className="muted">Result: <b>{JSON.stringify(output)}</b></p>}
      </div>

      {!premiumActive && (
        <div className="card">
          <b>Go Premium</b>
          <p className="muted small">Unlimited tool runs + premium tools.</p>
          <button onClick={() => buy('premium_lifetime')}>Unlock lifetime — ₹299</button>
          <div style={{ height: 8 }} />
          <button className="secondary" onClick={() => buy('premium_monthly')}>Monthly — ₹99/mo</button>
        </div>
      )}

      <div className="card">
        <b>Buy credits</b>
        <div className="grid" style={{ marginTop: 10 }}>
          {CREDIT_PACKS.map((p) => (
            <div key={p.id} className="pack" onClick={() => buy(p.id)}>
              <b>{p.label}</b>
              <span className="muted small">{p.price}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
