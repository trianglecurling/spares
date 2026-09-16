import { isLoopbackFrontendUrl, normalizeFrontendBaseUrl } from './frontendUrl.js';

/**
 * Dev servers (and any process still using a loopback FRONTEND_URL) must not
 * deliver through Azure/Twilio, even if they are pointed at the production DB.
 */
export function shouldForceDevOutbound(input: { nodeEnv: string; frontendUrl: string }): boolean {
  if (input.nodeEnv.trim().toLowerCase() !== 'production') return true;
  return isLoopbackFrontendUrl(normalizeFrontendBaseUrl(input.frontendUrl));
}
