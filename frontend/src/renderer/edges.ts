import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { buildArrowhead } from './geometry'
import { EDGE_VISUALS, EDGE_Y } from './registry'
import type { Edge } from '../spec/schema'
import type { LaidOutEdge } from './layout'

function buildPositionsArray(
  points: Array<{ x: number; z: number }>,
  offset: { x: number; z: number } = { x: 0, z: 0 }
): number[] {
  const out: number[] = []
  for (const p of points) {
    out.push(p.x + offset.x, EDGE_Y, p.z + offset.z)
  }
  return out
}

function buildLine(
  positions: number[],
  color: number,
  dashed: boolean,
  dashSize: number,
  gapSize: number,
  resolution: THREE.Vector2,
  linewidth: number
): Line2 {
  const geo = new LineGeometry()
  geo.setPositions(positions)
  const mat = new LineMaterial({
    color,
    linewidth,
    dashed,
    dashSize,
    gapSize,
    transparent: true,
    opacity: 0.9,
  })
  mat.resolution.copy(resolution)
  const line = new Line2(geo, mat)
  line.computeLineDistances()
  return line
}

function perpendicularOffset(
  points: Array<{ x: number; z: number }>,
  distance: number
): { x: number; z: number } {
  if (points.length < 2) return { x: 0, z: 0 }
  const a = points[0]
  const b = points[1]
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = Math.hypot(dx, dz) || 1
  return { x: (-dz / len) * distance, z: (dx / len) * distance }
}

export interface BuiltEdge {
  group: THREE.Group
  lineMaterials: LineMaterial[]
}

export function buildEdge(
  spec: Edge,
  laid: LaidOutEdge,
  resolution: THREE.Vector2
): BuiltEdge {
  const v = EDGE_VISUALS[spec.kind]
  const group = new THREE.Group()
  group.userData.edgeId = spec.id

  const lineMaterials: LineMaterial[] = []

  const linewidth = 2.0
  if (v.doubleStroke) {
    const off = perpendicularOffset(laid.points, 0.12)
    const lineA = buildLine(
      buildPositionsArray(laid.points, off),
      v.color,
      false,
      0,
      0,
      resolution,
      linewidth
    )
    const lineB = buildLine(
      buildPositionsArray(laid.points, { x: -off.x, z: -off.z }),
      v.color,
      false,
      0,
      0,
      resolution,
      linewidth
    )
    group.add(lineA, lineB)
    lineMaterials.push(lineA.material as LineMaterial, lineB.material as LineMaterial)
  } else {
    const line = buildLine(
      buildPositionsArray(laid.points),
      v.color,
      v.dashed,
      v.dashSize,
      v.gapSize,
      resolution,
      linewidth
    )
    group.add(line)
    lineMaterials.push(line.material as LineMaterial)
  }

  // Arrowhead at the destination end.
  if (laid.points.length >= 2) {
    const end = laid.points[laid.points.length - 1]
    const prev = laid.points[laid.points.length - 2]
    const dir = new THREE.Vector3(end.x - prev.x, 0, end.z - prev.z)
    const len = dir.length()
    if (len > 1e-4) {
      dir.normalize()
      const arrow = buildArrowhead(v.color)
      arrow.position.set(end.x, EDGE_Y, end.z)
      // ConeGeometry's tip is +Y. Aim it toward `dir`.
      const up = new THREE.Vector3(0, 1, 0)
      const quat = new THREE.Quaternion().setFromUnitVectors(up, dir)
      arrow.quaternion.copy(quat)
      group.add(arrow)
    }
  }

  return { group, lineMaterials }
}
