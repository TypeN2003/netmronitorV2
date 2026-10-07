import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { HttpError } from './auth.js';

export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}`, code: 'NOT_FOUND' });
};

/** Single place that turns thrown values into a consistent `{ error, code }` body. */
export const errorHandler = (
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, code: error.code ?? 'ERROR' });
    return;
  }

  if (error instanceof ZodError) {
    const details = error.errors.map(e => ({
      field: e.path.join('.') || '(body)',
      message: e.message,
    }));
    res.status(400).json({
      error: details.map(d => `${d.field}: ${d.message}`).join('; '),
      code: 'VALIDATION_FAILED',
      details,
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 unique constraint, P2025 record not found
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? (error.meta?.target as string[]).join(', ') : 'field';
      res.status(409).json({ error: `Already in use: ${target}`, code: 'DUPLICATE' });
      return;
    }
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'Record not found', code: 'NOT_FOUND' });
      return;
    }
    res.status(400).json({ error: `Database rejected the request (${error.code})`, code: error.code });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected server error';
  console.error('[error]', error);
  res.status(500).json({ error: message, code: 'INTERNAL' });
};

/** Wraps an async handler so a rejected promise reaches the error handler. */
export const asyncHandler =
  <T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    void Promise.resolve(fn(req as T, res, next)).catch(next);
  };
