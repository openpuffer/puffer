import { logger } from '@puffer/core';

/**
 * TLS/Certificate handling for HTTPS interception.
 * For the MVP, Puffer operates as an HTTP proxy and does not
 * perform MITM TLS interception. Agents should be configured
 * to send requests to the Puffer proxy (HTTP) which then
 * forwards to the actual HTTPS endpoints.
 *
 * Future: Generate self-signed CA cert and install in system
 * trust store for transparent HTTPS interception.
 */
export function initTLS(): { enabled: boolean } {
  logger.debug('TLS interception not enabled in MVP — using HTTP proxy mode');
  return { enabled: false };
}
