import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'

export function createLabelRenderer(container: HTMLElement): CSS2DRenderer {
  const r = new CSS2DRenderer()
  r.setSize(container.clientWidth, container.clientHeight)
  const el = r.domElement
  el.style.position = 'absolute'
  el.style.top = '0'
  el.style.left = '0'
  el.style.width = '100%'
  el.style.height = '100%'
  el.style.pointerEvents = 'none'
  container.appendChild(el)
  return r
}

export function makeNodeLabel(label: string, subtype?: string): CSS2DObject {
  const wrap = document.createElement('div')
  wrap.className = 'viz-label viz-label-node'
  const title = document.createElement('div')
  title.className = 'viz-label-title'
  title.textContent = label
  wrap.appendChild(title)
  if (subtype) {
    const sub = document.createElement('div')
    sub.className = 'viz-label-subtype'
    sub.textContent = subtype
    wrap.appendChild(sub)
  }
  return new CSS2DObject(wrap)
}

export function makeEdgeLabel(text: string): CSS2DObject {
  const el = document.createElement('div')
  el.className = 'viz-label viz-label-edge'
  el.textContent = text
  return new CSS2DObject(el)
}

export function makeGroupLabel(text: string): CSS2DObject {
  const el = document.createElement('div')
  el.className = 'viz-label viz-label-group'
  el.textContent = text
  return new CSS2DObject(el)
}
