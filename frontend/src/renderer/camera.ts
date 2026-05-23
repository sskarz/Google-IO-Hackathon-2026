import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const ELEVATION_RAD = (30 * Math.PI) / 180
const AZIMUTH_RAD = (45 * Math.PI) / 180
const CAMERA_DISTANCE = 50

export function createIsoCamera(aspect: number): THREE.OrthographicCamera {
  const frustum = 20
  const cam = new THREE.OrthographicCamera(
    (-frustum * aspect) / 2,
    (frustum * aspect) / 2,
    frustum / 2,
    -frustum / 2,
    -200,
    500
  )
  positionIso(cam, new THREE.Vector3(0, 0, 0))
  return cam
}

function positionIso(cam: THREE.OrthographicCamera, target: THREE.Vector3) {
  const r = CAMERA_DISTANCE
  const x = target.x + r * Math.cos(ELEVATION_RAD) * Math.sin(AZIMUTH_RAD)
  const y = target.y + r * Math.sin(ELEVATION_RAD)
  const z = target.z + r * Math.cos(ELEVATION_RAD) * Math.cos(AZIMUTH_RAD)
  cam.position.set(x, y, z)
  cam.lookAt(target)
}

export function createControls(
  camera: THREE.Camera,
  dom: HTMLElement
): OrbitControls {
  const c = new OrbitControls(camera, dom)
  c.enableDamping = true
  c.dampingFactor = 0.12
  c.enablePan = true
  c.minZoom = 0.4
  c.maxZoom = 4
  // Prevent diving below the ground plane.
  c.minPolarAngle = 0.1
  c.maxPolarAngle = Math.PI / 2 - 0.05
  return c
}

export interface AutoFrameArgs {
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number }
  aspect: number
  camera: THREE.OrthographicCamera
  controls: OrbitControls
}

export function autoFrame({ bounds, aspect, camera, controls }: AutoFrameArgs) {
  const width = bounds.maxX - bounds.minX
  const depth = bounds.maxZ - bounds.minZ
  const cx = (bounds.minX + bounds.maxX) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2
  const padding = 1.4
  // Ortho frustum needs to contain the rotated bounding box. We approximate
  // by taking the larger of width / depth and applying aspect.
  const desired = Math.max(width, depth) * padding
  const halfH = Math.max(desired / 2, 6)
  camera.top = halfH
  camera.bottom = -halfH
  camera.left = -halfH * aspect
  camera.right = halfH * aspect
  camera.zoom = 1
  camera.updateProjectionMatrix()

  const target = new THREE.Vector3(cx, 0, cz)
  controls.target.copy(target)
  positionIso(camera, target)
  controls.update()
}

export interface FlyToState {
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
  fromZoom: number
  toZoom: number
  startMs: number
  durationMs: number
}

export function startFlyTo(
  camera: THREE.OrthographicCamera,
  controls: OrbitControls,
  to: THREE.Vector3,
  zoom: number,
  durationMs = 450
): FlyToState {
  return {
    fromTarget: controls.target.clone(),
    toTarget: to.clone(),
    fromZoom: camera.zoom,
    toZoom: zoom,
    startMs: performance.now(),
    durationMs,
  }
}

export function tickFlyTo(
  state: FlyToState,
  camera: THREE.OrthographicCamera,
  controls: OrbitControls
): boolean {
  const t = Math.min(1, (performance.now() - state.startMs) / state.durationMs)
  const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 // easeInOutQuad
  const next = state.fromTarget.clone().lerp(state.toTarget, eased)
  controls.target.copy(next)
  camera.zoom = state.fromZoom + (state.toZoom - state.fromZoom) * eased
  camera.updateProjectionMatrix()
  positionIso(camera, next)
  controls.update()
  return t >= 1
}
