import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import {
  HttpError,
  requireAuth,
  requirePermission,
  type AuthedRequest,
} from '../middleware/auth.js';
import { uid } from '../utils/id.js';
import { serializeTopologyLink, serializeTopologyNode } from '../services/serialize.js';

export const topologyRouter = Router();

// Everyone can look at the map; only canEditTopology may change it
topologyRouter.use(requireAuth);
const canEdit = requirePermission('canEditTopology');

const NODE_TYPES = [
  'wan',
  'router',
  'firewall',
  'core_switch',
  'dist_switch',
  'edge_ap',
  'host_group',
  'server',
] as const;

const LINK_TYPES = ['fiber_10g', 'copper_1g', 'fiber_40g', 'trunk'] as const;

const LINK_SPEED_LABEL: Record<string, string> = {
  fiber_10g: '10 Gbps SFP+',
  copper_1g: '1 Gbps Cat6',
  fiber_40g: '40 Gbps QSFP+',
  trunk: 'VLAN 802.1Q Trunk',
};

topologyRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [nodes, links] = await Promise.all([
      prisma.topologyNode.findMany({ orderBy: [{ tier: 'asc' }, { x: 'asc' }] }),
      prisma.topologyLink.findMany(),
    ]);
    res.json({ nodes: nodes.map(serializeTopologyNode), links: links.map(serializeTopologyLink) });
  })
);

// ---------------------------------------------------------------- nodes

topologyRouter.post(
  '/nodes',
  canEdit,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      label: z.string().trim().min(1).max(120),
      ip: z.string().trim().max(60).optional(),
      tier: z.number().int().min(1).max(5),
      type: z.enum(NODE_TYPES),
      status: z.enum(['online', 'warning', 'offline']).optional(),
      x: z.number(),
      y: z.number(),
      groupCount: z.number().int().optional(),
      model: z.string().trim().max(160).optional(),
      deviceId: z.string().optional(),
    });
    const input = schema.parse(req.body);

    if (input.deviceId) {
      const device = await prisma.device.findUnique({ where: { id: input.deviceId } });
      if (!device) throw new HttpError(404, 'Device not found', 'NOT_FOUND');
    }

    const node = await prisma.topologyNode.create({
      data: {
        id: uid('node'),
        label: input.label,
        ip: input.ip ?? '',
        tier: input.tier,
        type: input.type,
        status: input.status ?? 'online',
        x: input.x,
        y: input.y,
        groupCount: input.groupCount,
        model: input.model,
        deviceId: input.deviceId,
      },
    });
    res.status(201).json(serializeTopologyNode(node));
  })
);

topologyRouter.patch(
  '/nodes/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      label: z.string().trim().min(1).max(120).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      isCollapsed: z.boolean().optional(),
      tier: z.number().int().min(1).max(5).optional(),
      type: z.enum(NODE_TYPES).optional(),
      deviceId: z.string().nullable().optional(),
    });
    const input = schema.parse(req.body);

    const existing = await prisma.topologyNode.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Topology node not found', 'NOT_FOUND');

    const node = await prisma.topologyNode.update({ where: { id: existing.id }, data: input });
    res.json(serializeTopologyNode(node));
  })
);

/**
 * PUT /api/topology/layout
 *
 * Saves every node position in one request. Dragging a node fires a PATCH per drop,
 * but the "Save layout" button writes the whole canvas at once.
 */
topologyRouter.put(
  '/layout',
  canEdit,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      nodes: z.array(z.object({ id: z.string(), x: z.number(), y: z.number(), isCollapsed: z.boolean().optional() })),
    });
    const { nodes } = schema.parse(req.body);

    await prisma.$transaction(
      nodes.map(node =>
        prisma.topologyNode.update({
          where: { id: node.id },
          data: { x: node.x, y: node.y, ...(node.isCollapsed === undefined ? {} : { isCollapsed: node.isCollapsed }) },
        })
      )
    );

    const saved = await prisma.topologyNode.findMany({ orderBy: [{ tier: 'asc' }, { x: 'asc' }] });
    res.json({ nodes: saved.map(serializeTopologyNode) });
  })
);

topologyRouter.delete(
  '/nodes/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const node = await prisma.topologyNode.findUnique({ where: { id: req.params.id } });
    if (!node) throw new HttpError(404, 'Topology node not found', 'NOT_FOUND');

    // Dangling links would draw lines to nothing
    await prisma.topologyLink.deleteMany({ where: { OR: [{ source: node.id }, { target: node.id }] } });
    await prisma.topologyNode.delete({ where: { id: node.id } });
    res.json({ success: true });
  })
);

// ---------------------------------------------------------------- links

topologyRouter.post(
  '/links',
  canEdit,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      source: z.string().min(1),
      target: z.string().min(1),
      linkType: z.enum(LINK_TYPES),
    });
    const input = schema.parse(req.body);

    if (input.source === input.target) {
      throw new HttpError(400, 'A link needs two different nodes', 'SELF_LINK');
    }

    const nodes = await prisma.topologyNode.findMany({
      where: { id: { in: [input.source, input.target] } },
      select: { id: true },
    });
    if (nodes.length !== 2) throw new HttpError(404, 'One of the nodes does not exist', 'NOT_FOUND');

    const duplicate = await prisma.topologyLink.findFirst({
      where: {
        OR: [
          { source: input.source, target: input.target },
          { source: input.target, target: input.source },
        ],
      },
    });
    if (duplicate) throw new HttpError(409, 'These two nodes are already linked', 'LINK_EXISTS');

    const link = await prisma.topologyLink.create({
      data: {
        id: uid('link'),
        source: input.source,
        target: input.target,
        linkType: input.linkType,
        speed: LINK_SPEED_LABEL[input.linkType],
        status: 'up',
      },
    });
    res.status(201).json(serializeTopologyLink(link));
  })
);

topologyRouter.patch(
  '/links/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const { linkType } = z.object({ linkType: z.enum(LINK_TYPES) }).parse(req.body);
    const existing = await prisma.topologyLink.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Link not found', 'NOT_FOUND');

    const link = await prisma.topologyLink.update({
      where: { id: existing.id },
      data: { linkType, speed: LINK_SPEED_LABEL[linkType] },
    });
    res.json(serializeTopologyLink(link));
  })
);

topologyRouter.delete(
  '/links/:id',
  canEdit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const existing = await prisma.topologyLink.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, 'Link not found', 'NOT_FOUND');
    await prisma.topologyLink.delete({ where: { id: existing.id } });
    res.json({ success: true });
  })
);
