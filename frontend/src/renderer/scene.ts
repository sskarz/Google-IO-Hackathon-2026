import * as THREE from 'three'
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { Spec } from '../spec/schema'
import { buildEdge } from './edges'
import { buildNodeMesh } from './geometry'
import {
  makeEdgeLabel,
  makeGroupLabel,
  makeNodeLabel,
} from './labels'
import { layoutSpec, type LaidOut } from './layout'
import { EDGE_Y, GROUND_COLOR, SCENE_BG } from './registry'

export interface SceneBuildResult {
  root: THREE.Group
  pickables: THREE.Object3D[]
  nodePositions: Map<string, THREE.Vector3>
  bounds: LaidOut['bounds']
  lineMaterials: LineMaterial[]
}

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SCENE_BG)

  const ambient = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambient)

  const dir = new THREE.DirectionalLight(0xffffff, 0.8)
  dir.position.set(8, 12, 6)
  scene.add(dir)

  // Subtle ground plane that anchors the contact shadows.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: GROUND_COLOR })
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = false
  ground.position.y = 0
  scene.add(ground)

  return scene
}

export async function buildSceneFromSpec(
  spec: Spec,
  resolution: THREE.Vector2
): Promise<SceneBuildResult> {
  const laid = await layoutSpec(spec)
  const root = new THREE.Group()
  const pickables: THREE.Object3D[] = []
  const nodePositions = new Map<string, THREE.Vector3>()
  const lineMaterials: LineMaterial[] = []

  // Groups: translucent bounding boxes with a faint border.
  for (const g of laid.groups) {
    const w = g.maxX - g.minX
    const d = g.maxZ - g.minZ
    const h = 0.04
    const cx = (g.minX + g.maxX) / 2
    const cz = (g.minZ + g.maxZ) / 2

    const fill = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({
        color: 0x6366f1,
        transparent: true,
        opacity: 0.05,
      })
    )
    fill.position.set(cx, 0.02, cz)

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({
        color: 0x6366f1,
        transparent: true,
        opacity: 0.5,
      })
    )
    border.position.set(cx, 0.02, cz)

    root.add(fill, border)

    const label = makeGroupLabel(g.label)
    label.position.set(g.minX + 0.4, 0.5, g.minZ + 0.4)
    root.add(label)
  }

  // Nodes.
  const specNodes = new Map(spec.nodes.map((n) => [n.id, n]))
  for (const n of laid.nodes) {
    const specNode = specNodes.get(n.id)
    if (!specNode) continue
    const { group, pickable } = buildNodeMesh(specNode)
    group.position.set(n.cx, 0, n.cz)
    nodePositions.set(n.id, new THREE.Vector3(n.cx, 0, n.cz))
    pickables.push(...pickable)
    root.add(group)

    const label = makeNodeLabel(specNode.label, specNode.subtype)
    // Position below the mesh.
    const labelY = -0.05
    label.position.set(n.cx, labelY, n.cz + Math.max(n.h / 2, 1.6) + 0.2)
    root.add(label)
  }

  // Edges.
  const specEdges = new Map(spec.edges.map((e) => [e.id, e]))
  for (const laidEdge of laid.edges) {
    const specEdge = specEdges.get(laidEdge.id)
    if (!specEdge) continue
    const { group, lineMaterials: lm } = buildEdge(
      specEdge,
      laidEdge,
      resolution
    )
    root.add(group)
    lineMaterials.push(...lm)

    if (specEdge.label && laidEdge.points.length >= 2) {
      // Place edge label at the geometric midpoint of the polyline.
      const mid = midpointOfPolyline(laidEdge.points)
      const label = makeEdgeLabel(specEdge.label)
      label.position.set(mid.x, EDGE_Y + 0.25, mid.z)
      root.add(label)
    }
  }

  return { root, pickables, nodePositions, bounds: laid.bounds, lineMaterials }
}

function midpointOfPolyline(points: Array<{ x: number; z: number }>): {
  x: number
  z: number
} {
  let total = 0
  const lengths: number[] = []
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dz = points[i].z - points[i - 1].z
    const len = Math.hypot(dx, dz)
    lengths.push(len)
    total += len
  }
  if (total === 0) return points[0]
  const half = total / 2
  let acc = 0
  for (let i = 0; i < lengths.length; i++) {
    if (acc + lengths[i] >= half) {
      const t = (half - acc) / lengths[i]
      const a = points[i]
      const b = points[i + 1]
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
    }
    acc += lengths[i]
  }
  return points[points.length - 1]
}

export function disposeSceneContent(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry?.dispose()
      const m = mesh.material
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose())
      else m?.dispose()
    }
    const line = obj as THREE.LineSegments
    if (line.isLineSegments) {
      line.geometry?.dispose()
      ;(line.material as THREE.Material)?.dispose()
    }
  })
}
