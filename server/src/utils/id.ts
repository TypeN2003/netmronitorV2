import { randomUUID, createHash, randomInt } from 'node:crypto';

/** `dev-3f8a1c2b` — short, prefixed, collision-safe ids in the shape the frontend expects. */
export const uid = (prefix: string): string => `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 10)}`;

/** Real SHA-256 of a config, used as the backup checksum shown in the Backup Manager. */
export const sha256 = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

/** `NET-482910` — the password-reset code shown on the Forgot Password screen. */
export const otpCode = (): string => `NET-${randomInt(100000, 1000000)}`;
