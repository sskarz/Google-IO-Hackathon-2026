import * as THREE from 'three'
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { Edge, Spec } from '../spec/schema'
import { buildEdge } from './edges'
import { buildNodeMesh } from './geometry'
import { makeGroupLabel, makeNodeLabel } from './labels'
import { layoutSpec, type LaidOut } from './layout'
import { createEdgeParticles } from './particles'
import {
  EDGE_Y,
  GROUND_COLOR,
  GROUP_BORDER_OPACITY,
  GROUP_FILL_OPACITY,
  GROUP_LABEL_Y,
  GROUP_VISUALS,
  MAX_MESH_HEIGHT,
  NODE_LABEL_Y,
  NODE_VISUALS,
  SCENE_BG,
} from './registry'

export interface EdgeHitbox {
  mesh: THREE.Mesh
  edgeId: string
  spec: Edge
  midpoint: THREE.Vector3
}

export interface SceneAABB3D {
  min: THREE.Vector3
  max: THREE.Vector3
}

export type ParticleTicker = (deltaSec: number) => void

export interface SceneBuildResult {
  root: THREE.Group
  pickables: THREE.Object3D[]
  nodeBoxes: Map<string, THREE.Box3>
  bounds: LaidOut['bounds']
  aabb3D: SceneAABB3D
  lineMaterials: LineMaterial[]
  edgeHitboxes: EdgeHitbox[]
  particleTickers: ParticleTicker[]
}

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(SCENE_BG)

  const ambient = new THREE.AmbientLight(0xffffff, 0.75)
  scene.add(ambient)

  const dir = new THREE.DirectionalLight(0xffffff, 0.9)
  dir.position.set(8, 12, 6)
  scene.add(dir)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshLambertMaterial({ color: GROUND_COLOR })
  )
  ground.rotation.x = -Math.PI / 2
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
  const nodeBoxes = new Map<string, THREE.Box3>()
  const lineMaterials: LineMaterial[] = []
  const edgeHitboxes: EdgeHitbox[] = []
  const particleTickers: ParticleTicker[] = []

  const specGroupsById = new Map(spec.groups?.map((g) => [g.id, g]) ?? [])

  // Groups: translucent box, visible border, caption above the group.
  for (const g of laid.groups) {
    const groupType = specGroupsById.get(g.id)?.type ?? 'boundary'
    const v = GROUP_VISUALS[groupType]
    const w = g.maxX - g.minX
    const d = g.maxZ - g.minZ
    const h = 0.04
    const cx = (g.minX + g.maxX) / 2
    const cz = (g.minZ + g.maxZ) / 2

    const fill = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({
        color: v.fillColor,
        transparent: true,
        opacity: GROUP_FILL_OPACITY,
        depthWrite: false,
      })
    )
    fill.position.set(cx, 0.02, cz)

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({
        color: v.borderColor,
        transparent: true,
        opacity: GROUP_BORDER_OPACITY,
      })
    )
    border.position.set(cx, 0.02, cz)

    root.add(fill, border)

    // Caption above the group's near edge, well above any node label.
    const label = makeGroupLabel(g.label)
    label.position.set(cx, GROUP_LABEL_Y, g.minZ - 0.5)
    root.add(label)
  }

  // Nodes.
  const specNodes = new Map(spec.nodes.map((n) => [n.id, n]))
  for (const n of laid.nodes) {
    const specNode = specNodes.get(n.id)
    if (!specNode) continue
    const v = NODE_VISUALS[specNode.type]

    const { group, pickable } = buildNodeMesh(specNode)
    group.position.set(n.cx, 0, n.cz)
    pickables.push(...pickable)
    root.add(group)

    // World-space AABB used for double-click zoom-to-fit.
    const replicas = Math.min(Math.max(specNode.replicas ?? 1, 1), 5)
    const drift = (replicas - 1) * 0.25
    const halfW = v.footprintW / 2 + drift * 0.5
    const halfH = v.footprintH / 2 + drift * 0.5
    nodeBoxes.set(
      specNode.id,
      new THREE.Box3(
        new THREE.Vector3(n.cx - halfW, 0, n.cz - halfH),
        new THREE.Vector3(
          n.cx + halfW,
          v.meshHeight + drift * 0.15,
          n.cz + halfH
        )
      )
    )

    // Every node label sits at NODE_LABEL_Y, so a row of mixed-type nodes
    // shares a consistent screen-Y baseline.
    const label = makeNodeLabel(specNode.label, specNode.subtype)
    label.position.set(n.cx, NODE_LABEL_Y, n.cz)
    root.add(label)
  }

  // Edges: visible Line2 + invisible TubeGeometry hitbox for hover.
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

    if (laidEdge.points.length >= 2) {
      // Build the curve once and share between hover hitbox and particles.
      const vec3Points = laidEdge.points.map(
        (p) => new THREE.Vector3(p.x, EDGE_Y, p.z)
      )
      const curve = new THREE.CatmullRomCurve3(
        vec3Points,
        false,
        'centripetal'
      )

      const hitMesh = buildEdgeHitboxFromCurve(curve, laidEdge.points.length, specEdge.id)
      root.add(hitMesh)
      const mid = midpointOfPolyline(laidEdge.points)
      edgeHitboxes.push({
        mesh: hitMesh,
        edgeId: specEdge.id,
        spec: specEdge,
        midpoint: new THREE.Vector3(mid.x, EDGE_Y + 0.5, mid.z),
      })

      const particles = createEdgeParticles(curve, specEdge.kind)
      root.add(particles.group)
      particleTickers.push(particles.tick)
    }
  }

  // Full 3D AABB so the camera can frame everything that's actually rendered.
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const g of laid.groups) {
    minX = Math.min(minX, g.minX)
    minZ = Math.min(minZ, g.minZ)
    maxX = Math.max(maxX, g.maxX)
    maxZ = Math.max(maxZ, g.maxZ)
  }
  for (const n of laid.nodes) {
    const node = specNodes.get(n.id)
    if (!node) continue
    const v = NODE_VISUALS[node.type]
    minX = Math.min(minX, n.cx - v.footprintW / 2)
    minZ = Math.min(minZ, n.cz - v.footprintH / 2)
    maxX = Math.max(maxX, n.cx + v.footprintW / 2)
    maxZ = Math.max(maxZ, n.cz + v.footprintH / 2)
  }
  for (const e of laid.edges) {
    for (const p of e.points) {
      minX = Math.min(minX, p.x)
      minZ = Math.min(minZ, p.z)
      maxX = Math.max(maxX, p.x)
      maxZ = Math.max(maxZ, p.z)
    }
  }
  if (!isFinite(minX)) {
    minX = -1
    minZ = -1
    maxX = 1
    maxZ = 1
  }
  // Account for group captions floating above the diagram.
  const groupCaptionReach = laid.groups.length > 0 ? 1 : 0
  const aabb3D: SceneAABB3D = {
    min: new THREE.Vector3(minX, 0, minZ - groupCaptionReach),
    max: new THREE.Vector3(maxX, MAX_MESH_HEIGHT + groupCaptionReach, maxZ),
  }

  return {
    root,
    pickables,
    nodeBoxes,
    bounds: laid.bounds,
    aabb3D,
    lineMaterials,
    edgeHitboxes,
    particleTickers,
  }
}

function buildEdgeHitboxFromCurve(
  curve: THREE.CatmullRomCurve3,
  pointCount: number,
  edgeId: string
): THREE.Mesh {
  const segments = Math.min(Math.max(pointCount * 6, 12), 80)
  const geo = new THREE.TubeGeometry(curve, segments, 0.45, 6, false)
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.userData.edgeId = edgeId
  return mesh
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
    // CSS2D labels' DOM elements are appended to the labelRenderer's
    // container by CSS2DRenderer on first render. Removing the object from
    // the scene graph does NOT remove the DOM node — without this, every
    // setSpec leaves a layer of stale labels behind.
    if (obj instanceof CSS2DObject) {
      obj.element.parentNode?.removeChild(obj.element)
      return
    }
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
