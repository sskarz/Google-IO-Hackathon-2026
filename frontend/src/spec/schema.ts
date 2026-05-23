import { z } from 'zod'

export const NODE_TYPES = [
  'client',
  'cdn',
  'load_balancer',
  'api_gateway',
  'service',
  'worker',
  'database',
  'cache',
  'queue',
  'stream',
  'object_store',
  'search_index',
  'external',
] as const

export const EDGE_KINDS = ['sync', 'async', 'replication', 'data_flow'] as const

export const GROUP_TYPES = ['vpc', 'region', 'az', 'cluster', 'boundary'] as const

const idRegex = /^[a-z][a-z0-9_]*$/

const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(idRegex, 'must be snake_case starting with a lowercase letter')

export const NodeSchema = z.object({
  id: idSchema,
  type: z.enum(NODE_TYPES),
  subtype: z.string().min(1).optional(),
  label: z.string().min(1).max(120),
  replicas: z.number().int().positive().max(99).optional(),
  groupId: idSchema.optional(),
})

export const EdgeSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  kind: z.enum(EDGE_KINDS),
  protocol: z.string().min(1).optional(),
  label: z.string().min(1).max(120).optional(),
})

export const GroupSchema = z.object({
  id: idSchema,
  type: z.enum(GROUP_TYPES),
  label: z.string().min(1).max(120),
  childIds: z.array(idSchema).min(1),
})

export const MetadataSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
})

export const SpecSchema = z.object({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  groups: z.array(GroupSchema).optional(),
  metadata: MetadataSchema.optional(),
})

export type NodeType = (typeof NODE_TYPES)[number]
export type EdgeKind = (typeof EDGE_KINDS)[number]
export type GroupType = (typeof GROUP_TYPES)[number]
export type Node = z.infer<typeof NodeSchema>
export type Edge = z.infer<typeof EdgeSchema>
export type Group = z.infer<typeof GroupSchema>
export type Spec = z.infer<typeof SpecSchema>
