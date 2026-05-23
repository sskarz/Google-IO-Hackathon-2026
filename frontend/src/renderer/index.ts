import * as THREE from 'three'
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { Spec } from '../spec/schema'
import {
  autoFrame,
  createControls,
  createIsoCamera,
  startFlyTo,
  tickFlyTo,
  type FlyToState,
} from './camera'
import { createLabelRenderer } from './labels'
import {
  buildSceneFromSpec,
  createScene,
  disposeSceneContent,
} from './scene'

export interface RendererHandle {
  setSpec(spec: Spec): Promise<void>
  dispose(): void
}

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
  const camera = createIsoCamera(
    container.clientWidth / container.clientHeight
  )
  const controls = createControls(camera, canvasEl)
  const labelRenderer = createLabelRenderer(container)
  const resolution = new THREE.Vector2(
    container.clientWidth,
    container.clientHeight
  )

  let currentRoot: THREE.Group | null = null
  let currentMaterials: LineMaterial[] = []
  let nodePositions = new Map<string, THREE.Vector3>()
  let pickables: THREE.Object3D[] = []
  let flyTo: FlyToState | null = null
  let rafId = 0
  let disposed = false

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

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
    const pos = nodePositions.get(nodeId)
    if (!pos) return
    flyTo = startFlyTo(camera, controls, pos, 1.8)
  }
  canvasEl.addEventListener('dblclick', onDblClick)

  function applySize() {
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    renderer.setSize(w, h)
    labelRenderer.setSize(w, h)
    resolution.set(w, h)
    currentMaterials.forEach((m) => m.resolution.copy(resolution))
    const aspect = w / h
    const halfH = (camera.top - camera.bottom) / 2
    camera.left = -halfH * aspect
    camera.right = halfH * aspect
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(applySize)
  ro.observe(container)

  function animate() {
    if (disposed) return
    if (flyTo) {
      const done = tickFlyTo(flyTo, camera, controls)
      if (done) flyTo = null
    }
    controls.update()
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
    rafId = requestAnimationFrame(animate)
  }

  async function setSpec(spec: Spec) {
    if (currentRoot) {
      scene.remove(currentRoot)
      disposeSceneContent(currentRoot)
    }
    const built = await buildSceneFromSpec(spec, resolution)
    currentRoot = built.root
    currentMaterials = built.lineMaterials
    nodePositions = built.nodePositions
    pickables = built.pickables
    scene.add(currentRoot)
    autoFrame({
      bounds: built.bounds,
      aspect: container.clientWidth / container.clientHeight,
      camera,
      controls,
    })
  }

  function dispose() {
    disposed = true
    cancelAnimationFrame(rafId)
    ro.disconnect()
    canvasEl.removeEventListener('dblclick', onDblClick)
    if (currentRoot) {
      scene.remove(currentRoot)
      disposeSceneContent(currentRoot)
    }
    controls.dispose()
    renderer.dispose()
    canvasEl.parentNode?.removeChild(canvasEl)
    labelRenderer.domElement.parentNode?.removeChild(labelRenderer.domElement)
  }

  animate()
  return { setSpec, dispose }
}
