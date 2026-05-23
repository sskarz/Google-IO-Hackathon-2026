import * as THREE from 'three'
import { NODE_VISUALS, type NodeVisual, type ShapeKind } from './registry'
import type { Node } from '../spec/schema'

function buildGeometry(shape: ShapeKind, v: NodeVisual): THREE.BufferGeometry {
  const fw = v.footprintW
  const fh = v.footprintH
  const mh = v.meshHeight
  switch (shape) {
    case 'box':
    case 'rounded_box':
      return new THREE.BoxGeometry(fw, mh, fh)
    case 'outlined_box':
      return new THREE.BoxGeometry(fw, mh, fh)
    case 'hexagon_prism':
      return new THREE.CylinderGeometry(fw / 2, fw / 2, mh, 6)
    case 'diamond':
      return new THREE.OctahedronGeometry(Math.min(fw, fh) / 2 + 0.2, 0)
    case 'trapezoid_prism': {
      const shape2d = new THREE.Shape()
      const top = fw * 0.6
      const bot = fw
      const half = fh / 2
      shape2d.moveTo(-bot / 2, -half)
      shape2d.lineTo(bot / 2, -half)
      shape2d.lineTo(top / 2, half)
      shape2d.lineTo(-top / 2, half)
      shape2d.closePath()
      const geo = new THREE.ExtrudeGeometry(shape2d, {
        depth: mh,
        bevelEnabled: false,
      })
      // Extrude is along +Z; rotate so depth becomes Y.
      geo.rotateX(-Math.PI / 2)
      geo.translate(0, mh / 2, 0)
      return geo
    }
    case 'cylinder':
      return new THREE.CylinderGeometry(fw / 2, fw / 2, mh, 32)
    case 'short_cylinder':
      return new THREE.CylinderGeometry(fw / 2, fw / 2, mh, 32)
    case 'wide_short_cylinder':
      return new THREE.CylinderGeometry(fw / 2, fw / 2, mh, 48)
    case 'capsule':
      return new THREE.CapsuleGeometry(fh / 2, fw - fh, 6, 16)
    case 'long_capsule':
      return new THREE.CapsuleGeometry(fh / 2, fw - fh, 6, 16)
    case 'octahedron':
      return new THREE.OctahedronGeometry(Math.min(fw, fh) / 2 + 0.2, 0)
  }
}

function buildMaterial(shape: ShapeKind, color: number): THREE.Material {
  if (shape === 'outlined_box') {
    return new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    })
  }
  return new THREE.MeshLambertMaterial({ color })
}

function orientCapsule(mesh: THREE.Mesh, shape: ShapeKind) {
  if (shape === 'capsule' || shape === 'long_capsule') {
    // Capsule axis defaults to Y; rotate to lie along X.
    mesh.rotation.z = Math.PI / 2
  }
}

export interface BuiltNode {
  // Root group positioned at the node center, sitting on the y=0 plane.
  group: THREE.Group
  // The main mesh(es) — for picking.
  pickable: THREE.Object3D[]
}

export function buildNodeMesh(node: Node): BuiltNode {
  const v = NODE_VISUALS[node.type]
  const replicas = Math.min(Math.max(node.replicas ?? 1, 1), 5)

  const group = new THREE.Group()
  group.userData.nodeId = node.id

  const pickable: THREE.Object3D[] = []
  for (let i = 0; i < replicas; i++) {
    const geo = buildGeometry(v.shape, v)
    const mat = buildMaterial(v.shape, v.color)
    const mesh = new THREE.Mesh(geo, mat)
    orientCapsule(mesh, v.shape)

    // Replica stack: small diagonal offset, each layer slightly back-right.
    const offset = i * 0.25
    mesh.position.set(offset, v.meshHeight / 2 + offset * 0.15, -offset)
    mesh.userData.nodeId = node.id
    group.add(mesh)
    pickable.push(mesh)
  }

  // Contact shadow disc on the ground plane.
  const shadowR = Math.max(v.footprintW, v.footprintH) * 0.55
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(shadowR, 32),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
    })
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.01
  group.add(shadow)

  return { group, pickable }
}

// Cone aligned along +Y; we'll rotate it to face the edge direction at use sites.
export function buildArrowhead(color: number): THREE.Mesh {
  const geo = new THREE.ConeGeometry(0.22, 0.55, 12)
  const mat = new THREE.MeshLambertMaterial({ color })
  return new THREE.Mesh(geo, mat)
}
