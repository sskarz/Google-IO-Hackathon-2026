import * as THREE from 'three'
import type { EdgeKind } from '../spec/schema'
import { EDGE_VISUALS } from './registry'

interface ParticleConfig {
  count: number
  radius: number
  speed: number // cycles per second along the edge
  bidirectional: boolean
}

// Per-kind animation character:
//   sync: steady stream of small dots                  (request/response)
//   async: fewer, slightly bigger dots                 (fire-and-forget bursts)
//   replication: dots traveling both ways              (sync between stores)
//   data_flow: large, slow chunks                      (batch movement)
const CONFIG: Record<EdgeKind, ParticleConfig> = {
  sync: { count: 3, radius: 0.13, speed: 0.45, bidirectional: false },
  async: { count: 2, radius: 0.18, speed: 0.28, bidirectional: false },
  replication: { count: 4, radius: 0.14, speed: 0.35, bidirectional: true },
  data_flow: { count: 2, radius: 0.22, speed: 0.18, bidirectional: false },
}

// Particles travel from T_MIN to T_MAX along the curve so they emerge from
// the source node face and disappear just before the destination arrowhead.
const T_MIN = 0.04
const T_MAX = 0.94

export interface EdgeParticles {
  group: THREE.Group
  tick: (deltaSec: number) => void
}

interface Particle {
  mesh: THREE.Mesh
  phase: number
  direction: 1 | -1
}

export function createEdgeParticles(
  curve: THREE.CatmullRomCurve3,
  kind: EdgeKind
): EdgeParticles {
  const cfg = CONFIG[kind]
  const visual = EDGE_VISUALS[kind]
  const group = new THREE.Group()

  const mat = new THREE.MeshBasicMaterial({
    color: visual.color,
    transparent: true,
    opacity: 0.95,
  })
  // Each particle gets its own geometry instance so disposeSceneContent
  // cleans them up via root.traverse().
  const particles: Particle[] = []
  for (let i = 0; i < cfg.count; i++) {
    const geo = new THREE.SphereGeometry(cfg.radius, 10, 8)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 2 // draw above edge lines
    const direction: 1 | -1 = cfg.bidirectional && i % 2 === 1 ? -1 : 1
    // Distribute initial phases so particles don't clump.
    const phase = (i / cfg.count) % 1
    particles.push({ mesh, phase, direction })
    group.add(mesh)
  }

  const tmp = new THREE.Vector3()

  function tick(deltaSec: number) {
    if (deltaSec <= 0) return
    const advance = cfg.speed * deltaSec
    for (const p of particles) {
      p.phase = (p.phase + advance) % 1
      const u = p.direction === 1 ? p.phase : 1 - p.phase
      const clamped = T_MIN + (T_MAX - T_MIN) * u
      curve.getPointAt(clamped, tmp)
      p.mesh.position.copy(tmp)
    }
  }

  return { group, tick }
}
