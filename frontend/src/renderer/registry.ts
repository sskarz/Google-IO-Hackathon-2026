import type { EdgeKind, GroupType, NodeType } from '../spec/schema'

export type ShapeKind =
  | 'box'
  | 'rounded_box'
  | 'hexagon_prism'
  | 'diamond'
  | 'trapezoid_prism'
  | 'cylinder'
  | 'short_cylinder'
  | 'wide_short_cylinder'
  | 'capsule'
  | 'long_capsule'
  | 'octahedron'
  | 'outlined_box'

export interface NodeVisual {
  shape: ShapeKind
  color: number
  // Footprint on the XZ ground plane (used for ELK layout)
  footprintW: number
  footprintH: number
  // Height of the mesh in the Y axis
  meshHeight: number
}

export const NODE_VISUALS: Record<NodeType, NodeVisual> = {
  client: { shape: 'rounded_box', color: 0x94a3b8, footprintW: 3.4, footprintH: 2.4, meshHeight: 1.1 },
  cdn: { shape: 'hexagon_prism', color: 0x06b6d4, footprintW: 3.2, footprintH: 3.2, meshHeight: 1.2 },
  load_balancer: { shape: 'diamond', color: 0x3b82f6, footprintW: 3.2, footprintH: 3.2, meshHeight: 1.6 },
  api_gateway: { shape: 'trapezoid_prism', color: 0x6366f1, footprintW: 4.0, footprintH: 2.8, meshHeight: 1.2 },
  service: { shape: 'box', color: 0x10b981, footprintW: 3.8, footprintH: 2.8, meshHeight: 1.4 },
  worker: { shape: 'box', color: 0x14b8a6, footprintW: 3.2, footprintH: 2.4, meshHeight: 1.1 },
  database: { shape: 'cylinder', color: 0x8b5cf6, footprintW: 3.0, footprintH: 3.0, meshHeight: 2.2 },
  cache: { shape: 'short_cylinder', color: 0xef4444, footprintW: 3.0, footprintH: 3.0, meshHeight: 1.3 },
  queue: { shape: 'capsule', color: 0xf59e0b, footprintW: 4.4, footprintH: 2.0, meshHeight: 1.4 },
  stream: { shape: 'long_capsule', color: 0xf97316, footprintW: 5.0, footprintH: 2.0, meshHeight: 1.4 },
  object_store: { shape: 'wide_short_cylinder', color: 0xa855f7, footprintW: 3.6, footprintH: 3.6, meshHeight: 1.0 },
  search_index: { shape: 'octahedron', color: 0xeab308, footprintW: 3.2, footprintH: 3.2, meshHeight: 2.0 },
  external: { shape: 'outlined_box', color: 0x64748b, footprintW: 3.8, footprintH: 2.8, meshHeight: 1.2 },
}

export interface EdgeVisual {
  color: number
  dashed: boolean
  dashSize: number
  gapSize: number
  doubleStroke: boolean
}

export const EDGE_VISUALS: Record<EdgeKind, EdgeVisual> = {
  sync: { color: 0xcbd5e1, dashed: false, dashSize: 0, gapSize: 0, doubleStroke: false },
  async: { color: 0xfbbf24, dashed: true, dashSize: 0.4, gapSize: 0.3, doubleStroke: false },
  replication: { color: 0xa78bfa, dashed: false, dashSize: 0, gapSize: 0, doubleStroke: true },
  data_flow: { color: 0x6ee7b7, dashed: true, dashSize: 0.1, gapSize: 0.2, doubleStroke: false },
}

export interface GroupVisual {
  fillColor: number
  borderColor: number
}

// Distinct per-type palette so adjacent groups read as different boundaries.
export const GROUP_VISUALS: Record<GroupType, GroupVisual> = {
  vpc: { fillColor: 0x6366f1, borderColor: 0x818cf8 },      // indigo
  region: { fillColor: 0x0ea5e9, borderColor: 0x38bdf8 },   // sky
  az: { fillColor: 0x14b8a6, borderColor: 0x2dd4bf },       // teal
  cluster: { fillColor: 0xec4899, borderColor: 0xf472b6 },  // pink
  boundary: { fillColor: 0x64748b, borderColor: 0x94a3b8 }, // slate
}

// Derived constants for label Y placement. NODE_LABEL_Y sits a hair above the
// tallest possible node mesh so every label has a consistent screen Y baseline.
// GROUP_LABEL_Y sits well above that so group captions float clear of any node.
export const MAX_MESH_HEIGHT = Math.max(
  ...Object.values(NODE_VISUALS).map((v) => v.meshHeight)
)
export const NODE_LABEL_Y = MAX_MESH_HEIGHT + 0.6
export const GROUP_LABEL_Y = MAX_MESH_HEIGHT + 1.6

export const GROUND_Y = 0
export const EDGE_Y = 0.08
export const SHADOW_Y = 0.005
export const SCENE_BG = 0x0a0a0a
export const GROUND_COLOR = 0x111114

export const GROUP_FILL_OPACITY = 0.13
export const GROUP_BORDER_OPACITY = 0.8
