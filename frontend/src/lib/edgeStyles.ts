import type { RelationshipKind } from '../types/domain'

export type EdgeStyle = Readonly<{
  color: string
  strokeDasharray?: string
  label: string
}>

export const getEdgeStyle = (kind: RelationshipKind): EdgeStyle => {
  switch (kind) {
    case 'family':       return { color: '#60a5fa', label: 'Family' }
    case 'parent_child': return { color: '#34d399', label: 'Parent / Child' }
    case 'romantic':     return { color: '#f472b6', label: 'Romantic' }
    case 'ally':         return { color: '#a78bfa', label: 'Ally' }
    case 'rival':        return { color: '#fb923c', label: 'Rival' }
    case 'enemy':        return { color: '#f87171', label: 'Enemy' }
    case 'mentor':       return { color: '#facc15', label: 'Mentor' }
    case 'other':        return { color: '#94a3b8', label: 'Other' }
  }
}
