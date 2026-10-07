import type { NextFunction, Request, Response } from 'express';
import type { User } from '@prisma/client';
import { prisma } from '../prisma.js';
import { verifyToken } from '../utils/jwt.js';

export type Role = 'Admin' | 'Engineer' | 'Viewer';

export interface AuthedRequest extends Request {
  user?: User;
}

/** `Somchai Prasert (Admin)` — the author string stored on alerts, backups and syslogs. */
export const authorOf = (user: User): string => `${user.name} (${user.role})`;

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = 'HttpError';
  }
}

const bearerToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (header && header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  // EventSource cannot set headers, so the SSE stream passes the token as a query param
  const queryToken = req.query.token;
  if (typeof queryToken === 'string' && queryToken) return queryToken;
  return null;
};

/** Rejects anything without a valid, unexpired token for an existing active user. */
export const requireAuth = async (req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> => {
  const token = bearerToken(req);
  if (!token) return next(new HttpError(401, 'Authentication required', 'NO_TOKEN'));

  const payload = verifyToken(token);
  if (!payload) return next(new HttpError(401, 'Session expired or token invalid', 'BAD_TOKEN'));

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) return next(new HttpError(401, 'Account no longer exists', 'NO_USER'));
  if (user.status !== 'Active') {
    return next(new HttpError(403, 'This account has been suspended by an administrator', 'SUSPENDED'));
  }

  req.user = user;
  next();
};

/**
 * Role gate. Mirrors the permission table in CLAUDE.md, which the Sidebar and
 * ProtectedRoute enforce on the client — this is the half that cannot be bypassed.
 */
export const requireRole =
  (...roles: Role[]) =>
  (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, 'Authentication required', 'NO_TOKEN'));
    if (!roles.includes(req.user.role as Role)) {
      return next(
        new HttpError(403, `This action requires one of these roles: ${roles.join(', ')}`, 'FORBIDDEN_ROLE')
      );
    }
    next();
  };

type PermissionKey =
  | 'canEditDevices'
  | 'canManageUsers'
  | 'canEditTopology'
  | 'canImportConfig'
  | 'canAcknowledgeAlerts'
  | 'canModifySettings'
  | 'canRebootDevices';

/** Per-user permission gate, for the switches an Admin can toggle on the Users page. */
export const requirePermission =
  (permission: PermissionKey) =>
  (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, 'Authentication required', 'NO_TOKEN'));
    if (!req.user[permission]) {
      return next(new HttpError(403, `Your account is missing the ${permission} permission`, 'FORBIDDEN_PERMISSION'));
    }
    next();
  };

/** Admin and Engineer can operate the NOC; Viewer only sees dashboard, topology and device status. */
export const requireOperator = requireRole('Admin', 'Engineer');
export const requireAdmin = requireRole('Admin');
