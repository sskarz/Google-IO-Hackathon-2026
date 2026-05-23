import { SpecSchema, type Spec } from './schema'

export interface ValidationIssue {
  path: string
  message: string
}

export type ValidationResult =
  | { ok: true; spec: Spec }
  | { ok: false; issues: ValidationIssue[] }

export function validateIntegrity(spec: Spec): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const nodeIds = new Set<string>()
  spec.nodes.forEach((n, i) => {
    if (nodeIds.has(n.id)) {
      issues.push({ path: `nodes[${i}].id`, message: `duplicate node id "${n.id}"` })
    }
    nodeIds.add(n.id)
  })

  const edgeIds = new Set<string>()
  spec.edges.forEach((e, i) => {
    if (edgeIds.has(e.id)) {
      issues.push({ path: `edges[${i}].id`, message: `duplicate edge id "${e.id}"` })
    }
    edgeIds.add(e.id)
    if (!nodeIds.has(e.from)) {
      issues.push({ path: `edges[${i}].from`, message: `edge references unknown node id "${e.from}"` })
    }
    if (!nodeIds.has(e.to)) {
      issues.push({ path: `edges[${i}].to`, message: `edge references unknown node id "${e.to}"` })
    }
    if (e.from === e.to) {
      issues.push({ path: `edges[${i}]`, message: `self-loop on node "${e.from}"` })
    }
  })

  const groupIds = new Set<string>()
  spec.groups?.forEach((g, gi) => {
    if (groupIds.has(g.id)) {
      issues.push({ path: `groups[${gi}].id`, message: `duplicate group id "${g.id}"` })
    }
    groupIds.add(g.id)
    g.childIds.forEach((cid, ci) => {
      if (!nodeIds.has(cid)) {
        issues.push({
          path: `groups[${gi}].childIds[${ci}]`,
          message: `group child references unknown node id "${cid}"`,
        })
      }
    })
  })

  spec.nodes.forEach((n, i) => {
    if (n.groupId && !groupIds.has(n.groupId)) {
      issues.push({
        path: `nodes[${i}].groupId`,
        message: `node references unknown group id "${n.groupId}"`,
      })
    }
  })

  return issues
}

export function parseAndValidate(input: unknown): ValidationResult {
  const parsed = SpecSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((zi) => ({
        path: zi.path.map(String).join('.') || '(root)',
        message: zi.message,
      })),
    }
  }
  const issues = validateIntegrity(parsed.data)
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, spec: parsed.data }
}

export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `- ${i.path}: ${i.message}`).join('\n')
}
