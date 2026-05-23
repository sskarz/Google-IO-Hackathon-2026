import * as THREE from 'three'
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { Spec } from '../spec/schema'
import {
  ANGLES_2D,
  ANGLES_3D,
  applyAngles,
  applyFrame,
  computeFrame,
  createCamera,
  createControls,
  frameForBox,
  snapshotFrame,
  startTransition,
  tickTransition,
  type Transition,
  type ViewMode,
} from './camera'
import { createLabelRenderer, makeEdgeLabel } from './labels'
import {
  buildSceneFromSpec,
  createScene,
  disposeSceneContent,
  type EdgeHitbox,
  type ParticleTicker,
  type SceneAABB3D,
} from './scene'

export type { ViewMode } from './camera'

export interface RendererHandle {
  setSpec(spec: Spec): Promise<void>
  setViewMode(mode: ViewMode): void
  getViewMode(): ViewMode
  dispose(): void
}

const MODE_TRANSITION_MS = 500
const FLY_TO_MS = 450

export function createRenderer(container: HTMLElement): RendererHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(container.clientWidth, container.clientHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const canvasEl = renderer.domElement
  canvasEl.style.position = 'absolute'
  canvasEl.style.inset = '0'
  canvasEl.style.width = '100%'
  canvasEl.style.height = '100%'
  container.appendChild(canvasEl)

  const scene = createScene()
  const aspect0 = container.clientWidth / container.clientHeight
  const camera = createCamera(aspect0)
  let viewMode: ViewMode = '3d'
  const controls = createControls(camera, canvasEl, viewMode)
  const labelRenderer = createLabelRenderer(container)
  const resolution = new THREE.Vector2(
    container.clientWidth,
    container.clientHeight
  )

  // Shared edge tooltip — one CSS2D element reused for whichever edge is
  // currently hovered. Fades via the .viz-tooltip CSS class.
  const tooltip = makeEdgeLabel('')
  const tooltipEl = tooltip.element as HTMLDivElement
  tooltipEl.classList.add('viz-tooltip')
  tooltipEl.textContent = ''
  scene.add(tooltip)

  let currentRoot: THREE.Group | null = null
  let currentMaterials: LineMaterial[] = []
  let currentAabb: SceneAABB3D | null = null
  let nodeBoxes: Map<string, THREE.Box3> = new Map()
  let pickables: THREE.Object3D[] = []
  let edgeHitboxes: EdgeHitbox[] = []
  let edgeHitMeshes: THREE.Mesh[] = []
  let particleTickers: ParticleTicker[] = []
  let activeTransition: Transition | null = null
  let hoveredEdgeId: string | null = null
  let rafId = 0
  let lastFrameMs = 0
  let disposed = false

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  function currentAngles() {
    return viewMode === '3d' ? ANGLES_3D : ANGLES_2D
  }

  function showTooltip(eb: EdgeHitbox) {
    const s = eb.spec
    const protoPart = s.protocol ? ` · ${s.protocol}` : ''
    const text = s.label ?? `${s.from} → ${s.to}${protoPart}`
    tooltipEl.textContent = text
    tooltip.position.copy(eb.midpoint)
    tooltipEl.classList.add('visible')
  }

  function hideTooltip() {
    hoveredEdgeId = null
    tooltipEl.classList.remove('visible')
  }

  function onPointerMove(e: MouseEvent) {
    if (edgeHitMeshes.length === 0) return
    const rect = canvasEl.getBoundingClientRect()
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(edgeHitMeshes, false)
    if (hits.length === 0) {
      if (hoveredEdgeId !== null) hideTooltip()
      return
    }
    const edgeId = (hits[0].object.userData.edgeId as string) ?? null
    if (edgeId === hoveredEdgeId) return
    const eb = edgeHitboxes.find((h) => h.edgeId === edgeId)
    if (!eb) return
    hoveredEdgeId = edgeId
    showTooltip(eb)
  }

  function onPointerLeave() {
    hideTooltip()
  }

  function onDblClick(e: MouseEvent) {
    const rect = canvasEl.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(pickables, true)
    if (hits.length === 0) return
    let nodeId: string | undefined
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object
      while (obj && !obj.userData.nodeId) obj = obj.parent
      if (obj?.userData.nodeId) {
        nodeId = obj.userData.nodeId as string
        break
      }
    }
    if (!nodeId) return
    const box = nodeBoxes.get(nodeId)
    if (!box) return
    const to = frameForBox(box, camera, currentAngles(), 1.5)
    activeTransition = startTransition(
      snapshotFrame(camera, controls),
      to,
      FLY_TO_MS
    )
  }

  canvasEl.addEventListener('pointermove', onPointerMove)
  canvasEl.addEventListener('pointerleave', onPointerLeave)
  canvasEl.addEventListener('dblclick', onDblClick)

  function reframeForResize() {
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    renderer.setSize(w, h)
    labelRenderer.setSize(w, h)
    resolution.set(w, h)
    currentMaterials.forEach((m) => m.resolution.copy(resolution))
    if (currentAabb) {
      // Reframe so content stays visible at the new aspect ratio.
      const frame = computeFrame(currentAabb, w / h, currentAngles())
      applyFrame(camera, controls, frame)
    } else {
      const aspect = w / h
      const halfH = (camera.top - camera.bottom) / 2
      camera.left = -halfH * aspect
      camera.right = halfH * aspect
      camera.updateProjectionMatrix()
    }
  }
  const ro = new ResizeObserver(reframeForResize)
  ro.observe(container)

  function animate() {
    if (disposed) return
    const now = performance.now()
    const deltaSec = lastFrameMs ? Math.min((now - lastFrameMs) / 1000, 0.1) : 0
    lastFrameMs = now

    if (activeTransition) {
      // Transition's tickTransition already calls controls.update() with the
      // lerp'd state, so don't double-update here or damping fights it.
      const done = tickTransition(activeTransition, camera, controls)
      if (done) activeTransition = null
    } else {
      controls.update()
    }
    for (let i = 0; i < particleTickers.length; i++) {
      particleTickers[i](deltaSec)
    }
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
    rafId = requestAnimationFrame(animate)
  }

  async function setSpec(spec: Spec) {
    if (currentRoot) {
      scene.remove(currentRoot)
      disposeSceneContent(currentRoot)
    }
    activeTransition = null
    hideTooltip()
    const built = await buildSceneFromSpec(spec, resolution)
    currentRoot = built.root
    currentMaterials = built.lineMaterials
    nodeBoxes = built.nodeBoxes
    pickables = built.pickables
    edgeHitboxes = built.edgeHitboxes
    edgeHitMeshes = edgeHitboxes.map((eb) => eb.mesh)
    particleTickers = built.particleTickers
    currentAabb = built.aabb3D
    scene.add(currentRoot)
    const aspect = container.clientWidth / container.clientHeight
    const frame = computeFrame(built.aabb3D, aspect, currentAngles())
    applyFrame(camera, controls, frame)
    // Defensive: a previous setViewMode tween may have been interrupted
    // before its onComplete fired, leaving enableRotate stuck. Re-sync.
    controls.enableRotate = viewMode === '3d'
  }

  function setViewMode(mode: ViewMode) {
    if (mode === viewMode) return
    viewMode = mode
    hideTooltip()
    // Sync rotation state immediately so the user can drag the instant the
    // tween finishes (or even during it, in 3D mode).
    controls.enableRotate = mode === '3d'
    if (!currentAabb) {
      applyAngles(camera, controls.target, currentAngles())
      camera.updateProjectionMatrix()
      controls.update()
      return
    }
    const aspect = container.clientWidth / container.clientHeight
    const to = computeFrame(currentAabb, aspect, currentAngles())
    const from = snapshotFrame(camera, controls)
    activeTransition = startTransition(from, to, MODE_TRANSITION_MS)
  }

  function dispose() {
    disposed = true
    cancelAnimationFrame(rafId)
    ro.disconnect()
    canvasEl.removeEventListener('dblclick', onDblClick)
    canvasEl.removeEventListener('pointermove', onPointerMove)
    canvasEl.removeEventListener('pointerleave', onPointerLeave)
    if (currentRoot) {
      scene.remove(currentRoot)
      disposeSceneContent(currentRoot)
    }
    scene.remove(tooltip)
    controls.dispose()
    renderer.dispose()
    canvasEl.parentNode?.removeChild(canvasEl)
    labelRenderer.domElement.parentNode?.removeChild(labelRenderer.domElement)
  }

  animate()
  return {
    setSpec,
    setViewMode,
    getViewMode: () => viewMode,
    dispose,
  }
}
