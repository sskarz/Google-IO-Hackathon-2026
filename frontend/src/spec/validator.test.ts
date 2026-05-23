import { describe, expect, it } from 'vitest'
import { parseAndValidate, validateIntegrity } from './validator'
import type { Spec } from './schema'

const minimal: Spec = {
  nodes: [{ id: 'db', type: 'database', label: 'DB' }],
  edges: [],
}

describe('parseAndValidate', () => {
  it('accepts a minimal valid spec', () => {
    const r = parseAndValidate(minimal)
    expect(r.ok).toBe(true)
  })

  it('accepts a complete spec with groups and edges', () => {
    const r = parseAndValidate({
      metadata: { name: 'test' },
      nodes: [
        { id: 'lb', type: 'load_balancer', label: 'LB' },
        { id: 'api', type: 'service', label: 'API', replicas: 3, groupId: 'vpc1' },
        { id: 'db', type: 'database', subtype: 'postgres', label: 'DB', groupId: 'vpc1' },
      ],
      edges: [
        { id: 'lb_to_api', from: 'lb', to: 'api', kind: 'sync', protocol: 'http' },
        { id: 'api_to_db', from: 'api', to: 'db', kind: 'sync', protocol: 'sql' },
      ],
      groups: [
        { id: 'vpc1', type: 'vpc', label: 'Main VPC', childIds: ['api', 'db'] },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it('rejects a non-snake_case id', () => {
    const r = parseAndValidate({
      nodes: [{ id: 'DB-1', type: 'database', label: 'DB' }],
      edges: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.path.includes('id'))).toBe(true)
  })

  it('rejects an unknown node type', () => {
    const r = parseAndValidate({
      nodes: [{ id: 'x', type: 'banana', label: 'B' }],
      edges: [],
    })
    expect(r.ok).toBe(false)
  })

  it('rejects duplicate node ids', () => {
    const r = parseAndValidate({
      nodes: [
        { id: 'db', type: 'database', label: 'DB' },
        { id: 'db', type: 'cache', label: 'Cache' },
      ],
      edges: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.message.includes('duplicate'))).toBe(true)
  })

  it('rejects edges referencing unknown nodes', () => {
    const r = parseAndValidate({
      nodes: [{ id: 'a', type: 'service', label: 'A' }],
      edges: [{ id: 'a_to_b', from: 'a', to: 'b', kind: 'sync' }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.message.includes('"b"'))).toBe(true)
  })

  it('rejects self-loops on edges', () => {
    const r = parseAndValidate({
      nodes: [{ id: 'a', type: 'service', label: 'A' }],
      edges: [{ id: 'a_to_a', from: 'a', to: 'a', kind: 'sync' }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.message.includes('self-loop'))).toBe(true)
  })

  it('rejects groups with unknown child ids', () => {
    const r = parseAndValidate({
      nodes: [{ id: 'a', type: 'service', label: 'A' }],
      edges: [],
      groups: [{ id: 'g1', type: 'vpc', label: 'G', childIds: ['ghost'] }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.path.includes('childIds'))).toBe(true)
  })

  it('rejects nodes whose groupId is unknown', () => {
    const r = parseAndValidate({
      nodes: [{ id: 'a', type: 'service', label: 'A', groupId: 'missing' }],
      edges: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.path.includes('groupId'))).toBe(true)
  })

  it('rejects duplicate edge ids', () => {
    const r = parseAndValidate({
      nodes: [
        { id: 'a', type: 'service', label: 'A' },
        { id: 'b', type: 'service', label: 'B' },
      ],
      edges: [
        { id: 'a_to_b', from: 'a', to: 'b', kind: 'sync' },
        { id: 'a_to_b', from: 'b', to: 'a', kind: 'sync' },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.message.includes('duplicate edge'))).toBe(true)
  })
})

describe('validateIntegrity', () => {
  it('returns no issues for a clean spec', () => {
    expect(validateIntegrity(minimal)).toEqual([])
  })
})
