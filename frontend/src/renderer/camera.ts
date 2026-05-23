import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export type ViewMode = '3d' | '2d'

export interface CameraAngles {
  elevation: number // radians; 0 = horizontal, π/2 = top-down
  azimuth: number   // radians around world +Y
}

// True isometric: elevation arctan(1/√2) ≈ 35.264°, azimuth 45°. This gives
// the canonical iso projection where world unit vectors project to lines
// 120° apart on screen — symmetric and predictable.
export const ANGLES_3D: CameraAngles = {
  elevation: Math.atan(1 / Math.SQRT2),
  azimuth: Math.PI / 4,
}

// Top-down. A tiny epsilon off π/2 keeps OrbitControls' spherical math happy
// at the polar pole.
export const ANGLES_2D: CameraAngles = {
  elevation: Math.PI / 2 - 0.0005,
  azimuth: 0,
}

const CAMERA_DISTANCE = 50

export function createCamera(aspect: number): THREE.OrthographicCamera {
  const frustum = 20
  const cam = new THREE.OrthographicCamera(
    (-frustum * aspect) / 2,
    (frustum * aspect) / 2,
    frustum / 2,
    -frustum / 2,
    -500,
    1000
  )
  applyAngles(cam, new THREE.Vector3(0, 0, 0), ANGLES_3D)
  return cam
}

export function applyAngles(
  cam: THREE.OrthographicCamera,
  target: THREE.Vector3,
  angles: CameraAngles
) {
  const r = CAMERA_DISTANCE
  const x = target.x + r * Math.cos(angles.elevation) * Math.sin(angles.azimuth)
  const y = target.y + r * Math.sin(angles.elevation)
  const z = target.z + r * Math.cos(angles.elevation) * Math.cos(angles.azimuth)
  cam.position.set(x, y, z)
  cam.lookAt(target)
}

export function createControls(
  camera: THREE.Camera,
  dom: HTMLElement,
  mode: ViewMode
): OrbitControls {
  const c = new OrbitControls(camera, dom)
  c.enableDamping = true
  c.dampingFactor = 0.12
  c.enablePan = true
  c.enableRotate = mode === '3d'
  c.minZoom = 0.3
  c.maxZoom = 5
  c.minPolarAngle = 0.0
  c.maxPolarAngle = Math.PI / 2 - 0.0001
  return c
}

export interface SceneAABB {
  min: THREE.Vector3
  max: THREE.Vector3
}

function aabbCorners(aabb: SceneAABB): THREE.Vector3[] {
  const { min, max } = aabb
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ]
}

export interface FrameSnapshot {
  top: number
  bottom: number
  left: number
  right: number
  position: THREE.Vector3
  target: THREE.Vector3
  zoom: number
}

const DEFAULT_PADDING = 1.15

/**
 * Compute the orthographic frustum + camera position needed to frame the
 * given AABB at the given camera angles. Uses an actual view-space
 * projection of the AABB's 8 corners — no hand-derived axis coefficients —
 * so it works correctly at any angle (iso, top-down, anything in between).
 */
export function computeFrame(
  aabb: SceneAABB,
  aspect: number,
  angles: CameraAngles,
  padding = DEFAULT_PADDING
): FrameSnapshot {
  const target = new THREE.Vector3(
    (aabb.min.x + aabb.max.x) / 2,
    0,
    (aabb.min.z + aabb.max.z) / 2
  )
  // Throwaway camera positioned at the requested angles so we can project the
  // AABB corners into its view space without disturbing the live camera.
  const tmpCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000)
  applyAngles(tmpCam, target, angles)
  tmpCam.updateMatrixWorld(true)

  let minVX = Infinity
  let maxVX = -Infinity
  let minVY = Infinity
  let maxVY = -Infinity
  for (const c of aabbCorners(aabb)) {
    const v = c.clone().applyMatrix4(tmpCam.matrixWorldInverse)
    if (v.x < minVX) minVX = v.x
    if (v.x > maxVX) maxVX = v.x
    if (v.y < minVY) minVY = v.y
    if (v.y > maxVY) maxVY = v.y
  }

  // Symmetric frustum around the target. Take the larger absolute extent on
  // each axis so the AABB always fits regardless of where it sits in view.
  const halfW = Math.max(Math.abs(minVX), Math.abs(maxVX))
  const halfH = Math.max(Math.abs(minVY), Math.abs(maxVY))

  // Apply padding then enforce aspect: grow the smaller dimension to match.
  let frustumHalfH = halfH * padding
  let frustumHalfW = frustumHalfH * aspect
  const reqHalfW = halfW * padding
  if (frustumHalfW < reqHalfW) {
    frustumHalfW = reqHalfW
    frustumHalfH = frustumHalfW / aspect
  }
  // Floor so trivially small AABBs don't produce a microscopic frustum.
  frustumHalfH = Math.max(frustumHalfH, 4)
  frustumHalfW = Math.max(frustumHalfW, 4 * aspect)

  return {
    top: frustumHalfH,
    bottom: -frustumHalfH,
    left: -frustumHalfW,
    right: frustumHalfW,
    position: tmpCam.position.clone(),
    target,
    zoom: 1,
  }
}

export function applyFrame(
  camera: THREE.OrthographicCamera,
  controls: OrbitControls,
  frame: FrameSnapshot
) {
  camera.top = frame.top
  camera.bottom = frame.bottom
  camera.left = frame.left
  camera.right = frame.right
  camera.zoom = frame.zoom
  camera.position.copy(frame.position)
  controls.target.copy(frame.target)
  camera.lookAt(frame.target)
  camera.updateProjectionMatrix()
  controls.update()
}

export function snapshotFrame(
  camera: THREE.OrthographicCamera,
  controls: OrbitControls
): FrameSnapshot {
  return {
    top: camera.top,
    bottom: camera.bottom,
    left: camera.left,
    right: camera.right,
    position: camera.position.clone(),
    target: controls.target.clone(),
    zoom: camera.zoom,
  }
}

/**
 * Compute the FrameSnapshot that frames `box` at the given camera angles,
 * keeping the camera's CURRENT frustum dimensions and adjusting zoom to fit.
 * Used by double-click-to-focus so small nodes zoom in close and large nodes
 * don't clip.
 */
export function frameForBox(
  box: THREE.Box3,
  camera: THREE.OrthographicCamera,
  angles: CameraAngles,
  padding = 1.4
): FrameSnapshot {
  const center = box.getCenter(new THREE.Vector3())
  const tmpCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000)
  applyAngles(tmpCam, center, angles)
  tmpCam.updateMatrixWorld(true)

  let halfW = 0
  let halfH = 0
  for (const c of aabbCorners({ min: box.min, max: box.max })) {
    const v = c.clone().applyMatrix4(tmpCam.matrixWorldInverse)
    if (Math.abs(v.x) > halfW) halfW = Math.abs(v.x)
    if (Math.abs(v.y) > halfH) halfH = Math.abs(v.y)
  }
  // Current frustum half-extents (full size before zoom).
  const curHalfH = (camera.top - camera.bottom) / 2
  const curHalfW = (camera.right - camera.left) / 2
  // Required half-extents to fit box + padding.
  const reqHalfH = Math.max(halfH * padding, 0.5)
  const reqHalfW = Math.max(halfW * padding, 0.5)
  // zoom > 1 = zoomed in. Take the binding axis.
  const zoomY = curHalfH / reqHalfH
  const zoomX = curHalfW / reqHalfW
  // Cap at maxZoom to stay inside OrbitControls limits.
  const zoom = Math.min(zoomX, zoomY, 5)
  return {
    top: camera.top,
    bottom: camera.bottom,
    left: camera.left,
    right: camera.right,
    position: tmpCam.position.clone(),
    target: center,
    zoom,
  }
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export interface Transition {
  from: FrameSnapshot
  to: FrameSnapshot
  startMs: number
  durationMs: number
  onComplete?: () => void
}

export function startTransition(
  from: FrameSnapshot,
  to: FrameSnapshot,
  durationMs: number,
  onComplete?: () => void
): Transition {
  return { from, to, startMs: performance.now(), durationMs, onComplete }
}

export function tickTransition(
  t: Transition,
  camera: THREE.OrthographicCamera,
  controls: OrbitControls
): boolean {
  const raw = Math.min(1, (performance.now() - t.startMs) / t.durationMs)
  const e = ease(raw)
  camera.top = lerp(t.from.top, t.to.top, e)
  camera.bottom = lerp(t.from.bottom, t.to.bottom, e)
  camera.left = lerp(t.from.left, t.to.left, e)
  camera.right = lerp(t.from.right, t.to.right, e)
  camera.zoom = lerp(t.from.zoom, t.to.zoom, e)
  camera.position.lerpVectors(t.from.position, t.to.position, e)
  controls.target.lerpVectors(t.from.target, t.to.target, e)
  camera.lookAt(controls.target)
  camera.updateProjectionMatrix()
  controls.update()
  if (raw >= 1) {
    t.onComplete?.()
    return true
  }
  return false
}
