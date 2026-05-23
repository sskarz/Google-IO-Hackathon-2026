import ELK from 'elkjs/lib/elk.bundled.js'
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'
import type { Spec } from '../spec/schema'
import { NODE_VISUALS } from './registry'

export interface LaidOutNode {
  id: string
  cx: number // center X (world units, on XZ plane)
  cz: number // center Z
  w: number
  h: number
}

export interface LaidOutGroup {
  id: string
  // Bounding box on XZ plane in world units.
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  label: string
}

export interface LaidOutEdge {
  id: string
  // Polyline waypoints on the XZ plane. Endpoints touch node boundaries.
  points: Array<{ x: number; z: number }>
}

export interface LaidOut {
  nodes: LaidOutNode[]
  groups: LaidOutGroup[]
  edges: LaidOutEdge[]
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
}

const elk = new ELK()

export async function layoutSpec(spec: Spec): Promise<LaidOut> {
  const groupIds = new Set(spec.groups?.map((g) => g.id) ?? [])
  const childToGroup = new Map<string, string>()
  spec.groups?.forEach((g) =>
    g.childIds.forEach((cid) => childToGroup.set(cid, g.id))
  )
  spec.nodes.forEach((n) => {
    if (n.groupId && groupIds.has(n.groupId)) childToGroup.set(n.id, n.groupId)
  })

  const groupNodes = new Map<string, ElkNode>()
  spec.groups?.forEach((g) => {
    groupNodes.set(g.id, {
      id: g.id,
      labels: [{ text: g.label }],
      children: [],
      edges: [],
      layoutOptions: {
        'elk.padding': '[top=2.5, left=1.5, right=1.5, bottom=1.5]',
        'elk.spacing.nodeNode': '2.0',
      },
    })
  })

  const rootChildren: ElkNode[] = []
  spec.nodes.forEach((n) => {
    const v = NODE_VISUALS[n.type]
    const replicaPad = Math.min(Math.max(n.replicas ?? 1, 1), 5) * 0.25
    const elkNode: ElkNode = {
      id: n.id,
      width: v.footprintW + replicaPad,
      height: v.footprintH + replicaPad,
    }
    const groupId = childToGroup.get(n.id)
    if (groupId && groupNodes.has(groupId)) {
      groupNodes.get(groupId)!.children!.push(elkNode)
    } else {
      rootChildren.push(elkNode)
    }
  })
  groupNodes.forEach((g) => rootChildren.push(g))

  const elkEdges: ElkExtendedEdge[] = spec.edges.map((e) => ({
    id: e.id,
    sources: [e.from],
    targets: [e.to],
  }))

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '4.5',
      'elk.layered.spacing.nodeNodeBetweenLayers': '6.0',
      'elk.spacing.edgeNode': '2.0',
      'elk.spacing.edgeEdge': '1.0',
      'elk.padding': '[top=1.5, left=1.5, right=1.5, bottom=1.5]',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: rootChildren,
    edges: elkEdges,
  }

  const result = (await elk.layout(graph)) as ElkNode
  return parseElkResult(result, spec)
}

function parseElkResult(root: ElkNode, spec: Spec): LaidOut {
  const groupIds = new Set(spec.groups?.map((g) => g.id) ?? [])
  const groupLabels = new Map(spec.groups?.map((g) => [g.id, g.label]) ?? [])

  const nodes: LaidOutNode[] = []
  const groups: LaidOutGroup[] = []
  const edges: LaidOutEdge[] = []

  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity

  function walkNode(node: ElkNode, ox: number, oy: number) {
    const ax = (node.x ?? 0) + ox
    const ay = (node.y ?? 0) + oy
    const w = node.width ?? 0
    const h = node.height ?? 0
    if (node.id !== 'root') {
      if (groupIds.has(node.id)) {
        groups.push({
          id: node.id,
          minX: ax,
          minZ: ay,
          maxX: ax + w,
          maxZ: ay + h,
          label: groupLabels.get(node.id) ?? node.id,
        })
      } else {
        const cx = ax + w / 2
        const cz = ay + h / 2
        nodes.push({ id: node.id, cx, cz, w, h })
      }
      minX = Math.min(minX, ax)
      minZ = Math.min(minZ, ay)
      maxX = Math.max(maxX, ax + w)
      maxZ = Math.max(maxZ, ay + h)
    }
    node.children?.forEach((c) => walkNode(c, ax, ay))
  }
  walkNode(root, 0, 0)

  function walkEdges(node: ElkNode, ox: number, oy: number) {
    const ax = (node.x ?? 0) + ox
    const ay = (node.y ?? 0) + oy
    node.edges?.forEach((e) => {
      const pts: Array<{ x: number; z: number }> = []
      e.sections?.forEach((s) => {
        pts.push({ x: s.startPoint.x + ax, z: s.startPoint.y + ay })
        s.bendPoints?.forEach((bp) =>
          pts.push({ x: bp.x + ax, z: bp.y + ay })
        )
        pts.push({ x: s.endPoint.x + ax, z: s.endPoint.y + ay })
      })
      edges.push({ id: e.id, points: pts })
    })
    node.children?.forEach((c) => walkEdges(c, ax, ay))
  }
  walkEdges(root, 0, 0)

  if (!isFinite(minX)) {
    minX = minZ = 0
    maxX = maxZ = 1
  }

  // Center everything so the layout is roughly centered around the origin.
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  nodes.forEach((n) => {
    n.cx -= cx
    n.cz -= cz
  })
  groups.forEach((g) => {
    g.minX -= cx
    g.maxX -= cx
    g.minZ -= cz
    g.maxZ -= cz
  })
  edges.forEach((e) =>
    e.points.forEach((p) => {
      p.x -= cx
      p.z -= cz
    })
  )

  return {
    nodes,
    groups,
    edges,
    bounds: {
      minX: minX - cx,
      minZ: minZ - cz,
      maxX: maxX - cx,
      maxZ: maxZ - cz,
    },
  }
}
