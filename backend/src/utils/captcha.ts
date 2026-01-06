import crypto from 'crypto';
import { config } from '../config.js';

export interface CaptchaChallenge {
  token: string;
  question: string;
  expiresAt: string;
}

interface CaptchaPayload {
  a: number;
  b: number;
  exp: number; // unix ms
  nonce: string;
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecodeToString(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(payloadB64: string): string {
  return base64UrlEncode(crypto.createHmac('sha256', config.jwtSecret).update(payloadB64).digest());
}

export function createCaptchaChallenge(ttlMs: number = 10 * 60 * 1000): CaptchaChallenge {
  const a = Math.floor(Math.random() * 9) + 1; // 1-9
  const b = Math.floor(Math.random() * 9) + 1; // 1-9
  const exp = Date.now() + ttlMs;
  const nonce = crypto.randomBytes(8).toString('hex');

  const payload: CaptchaPayload = { a, b, exp, nonce };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = sign(payloadB64);
  const token = `${payloadB64}.${sig}`;

  return {
    token,
    question: `What is ${a} + ${b}?`,
    expiresAt: new Date(exp).toISOString(),
  };
}

export function verifyCaptchaAnswer(token: string, answer: number): { ok: true } | { ok: false; error: string } {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, error: 'Invalid CAPTCHA token' };
  }

  const [payloadB64, sig] = token.split('.', 2);
  if (!payloadB64 || !sig) return { ok: false, error: 'Invalid CAPTCHA token' };

  const expectedSig = sign(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, error: 'Invalid CAPTCHA token' };
  }

  let payload: CaptchaPayload;
  try {
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    return { ok: false, error: 'Invalid CAPTCHA token' };
  }

  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    return { ok: false, error: 'CAPTCHA expired' };
  }

  if (typeof payload.a !== 'number' || typeof payload.b !== 'number') {
    return { ok: false, error: 'Invalid CAPTCHA token' };
  }

  const expected = payload.a + payload.b;
  if (answer !== expected) {
    return { ok: false, error: 'Incorrect CAPTCHA answer' };
  }

  return { ok: true };
}

