import type { Settings } from '@prisma/client';
import { prisma } from '../prisma.js';

/** There is exactly one settings row; create it on first read. */
export const getSettings = async (): Promise<Settings> => {
  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.settings.create({ data: { id: 1 } });
};
