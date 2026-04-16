import { create } from 'zustand'

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export type Toast = {
  id:       string
  kind:     ToastKind
  title:    string
  detail?:  string
}

export type DiagnosticSummary = {
  errors:   number
  warnings: number
} | null

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type State = {
  toasts:             Toast[]
  diagnosticSummary:  DiagnosticSummary

  addToast:             (toast: Omit<Toast, 'id'>, autoDismissMs?: number) => void
  dismissToast:         (id: string) => void
  setDiagnosticSummary: (summary: DiagnosticSummary) => void
}

let counter = 0

export const useNotificationStore = create<State>((set) => ({
  toasts:            [],
  diagnosticSummary: null,

  addToast: (toast, autoDismissMs = 4000) => {
    const id = `toast-${++counter}`
    set(s => ({ toasts: [...s.toasts, { ...toast, id }] }))
    if (autoDismissMs > 0) {
      setTimeout(
        () => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
        autoDismissMs,
      )
    }
  },

  dismissToast: (id) =>
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  setDiagnosticSummary: (summary) =>
    set({ diagnosticSummary: summary }),
}))
