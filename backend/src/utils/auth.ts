import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { JWTPayload, Member } from '../types.js';
import { getDatabaseConfig } from '../db/config.js';

export function generateAuthCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function generateToken(member: Member): string {
  const payload: JWTPayload = {
    memberId: member.id,
    email: member.email,
    phone: member.phone,
    isAdmin: member.is_admin === 1,
  };

  // Token expires in 90 days
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '90d' });
}

export function generateEmailLinkToken(member: Member): string {
  const payload: JWTPayload = {
    memberId: member.id,
    email: member.email,
    phone: member.phone,
    isAdmin: member.is_admin === 1,
  };

  // Token expires in 24 hours for email links
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '24h' });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as JWTPayload;
  } catch {
    return null;
  }
}

export function isAdmin(member: Member): boolean {
  // Check database flag first
  if (member.is_admin === 1) return true;
  
  if (!member.email) return false;
  
  const normalizedEmail = normalizeEmail(member.email);
  
  // Check old .env config (for backward compatibility)
  if (config.admins.includes(normalizedEmail)) return true;
  
  // Check database config file (new way)
  const dbConfig = getDatabaseConfig();
  if (dbConfig && dbConfig.adminEmails) {
    const normalizedAdminEmails = dbConfig.adminEmails.map(e => normalizeEmail(e));
    if (normalizedAdminEmails.includes(normalizedEmail)) return true;
  }
  
  return false;
}

export function normalizePhone(phone: string): string {
  // Remove all non-numeric characters
  const digits = phone.replace(/\D/g, '');
  
  // If it's 10 digits, add +1 for US
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // If it's 11 digits and starts with 1, add +
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  // Otherwise return as is with + prefix if not present
  return digits.startsWith('+') ? digits : `+${digits}`;
}

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

