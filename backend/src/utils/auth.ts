import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { JWTPayload, Member } from '../types.js';
import { buildAuthzClaimsForMember, hasScope, isInServerAdminListsByEmail } from './rbac.js';

export function generateAuthCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function buildJwtPayloadForMember(member: Member): Promise<JWTPayload> {
  const authz = await buildAuthzClaimsForMember(member);
  return {
    memberId: member.id,
    email: member.email,
    phone: member.phone,
    isAdmin: hasScope(authz, 'admin.manage'),
    authz,
    issuedAtEpochMs: Date.now(),
  };
}

export function generateToken(payload: JWTPayload): string {
  // Token expires in 30 minutes.
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30m' });
}

export function generateEmailLinkToken(payload: JWTPayload): string {
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
  if (isServerAdmin(member)) return true;
  if (member.authz) return hasScope(member.authz, 'admin.manage');
  // Legacy fallback
  return member.is_admin === 1;
}

export function isCalendarAdmin(member: Member): boolean {
  if (member.authz) return hasScope(member.authz, 'calendar.manage') || isAdmin(member);
  if (member.is_calendar_admin === 1) return true; // Legacy fallback
  return isAdmin(member);
}

export function isContentAdmin(member: Member): boolean {
  if (member.authz) return hasScope(member.authz, 'content.manage') || isServerAdmin(member);
  if (member.is_content_admin === 1) return true; // Legacy fallback
  return isServerAdmin(member);
}

export function isSponsorAdmin(member: Member): boolean {
  if (member.authz) return hasScope(member.authz, 'sponsorship.manage') || isServerAdmin(member);
  if (member.is_sponsor_admin === 1) return true; // Legacy fallback
  return isServerAdmin(member);
}

export function isEventsAdmin(member: Member): boolean {
  if (member.authz) return hasScope(member.authz, 'events.manage') || isServerAdmin(member);
  return isServerAdmin(member);
}

export function isServerAdmin(member: Member): boolean {
  if (member.authz?.isServerAdmin) return true;
  if (isInServerAdminsList(member)) return true;
  return member.is_server_admin === 1;
}

export function isInServerAdminsList(member: Member): boolean {
  return isInServerAdminListsByEmail(member.email);
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

