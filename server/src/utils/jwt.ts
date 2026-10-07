import jwt from 'jsonwebtoken';
import { env } from '../env.js';

export interface TokenPayload {
  sub: string; // user id
  role: string;
  email: string;
}

export const generateToken = (payload: TokenPayload): string =>
  jwt.sign(payload, env.jwtSecret, { algorithm: 'HS256', expiresIn: env.jwtExpiresIn } as jwt.SignOptions);

/** Returns null for an expired, tampered or malformed token. */
export const verifyToken = (token: string): TokenPayload | null => {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !decoded.sub) return null;
    return { sub: String(decoded.sub), role: String(decoded.role ?? ''), email: String(decoded.email ?? '') };
  } catch {
    return null;
  }
};
