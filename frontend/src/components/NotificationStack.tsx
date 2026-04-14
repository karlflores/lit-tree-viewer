import { memo } from 'react'
import { useNotificationStore, type Toast, type ToastKind } from '../lib/notificationStore'

// ---------------------------------------------------------------------------
// Individual toast card
// ---------------------------------------------------------------------------

const TOAST_ACCENT: Record<ToastKind, string> = {
  success: 'text-green-400',
  error:   'text-red-400',
  warning: 'text-yellow-400',
  info:    'text-blue-400',
}

const ToastCard = memo(({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) => (
  <div className="flex items-start gap-3 w-72 bg-panel border border-border rounded-2xl shadow-xl px-4 py-3">
    <span className={['mt-0.5 text-sm', TOAST_ACCENT[toast.kind]].join(' ')} aria-hidden="true">
      {toast.kind === 'success' ? '✓' : toast.kind === 'error' ? '✕' : toast.kind === 'warning' ? '⚠' : 'ℹ'}
    </span>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-medium text-white/90 leading-snug">{toast.title}</p>
      {toast.detail && (
        <p className="text-xs text-white/40 leading-snug mt-0.5 truncate">{toast.detail}</p>
      )}
    </div>
    <button
      onClick={onDismiss}
      className="text-white/25 hover:text-white/70 text-xs leading-none mt-0.5 shrink-0 transition-colors"
      aria-label="Dismiss"
    >
      ✕
    </button>
  </div>
))

ToastCard.displayName = 'ToastCard'

// ---------------------------------------------------------------------------
// Diagnostic summary chip — persistent while the editor has issues
// ---------------------------------------------------------------------------

const DiagnosticChip = memo(() => {
  const summary = useNotificationStore(s => s.diagnosticSummary)
  if (!summary || (summary.errors === 0 && summary.warnings === 0)) return null

  return (
    <div className="flex items-center gap-2 w-72 bg-panel border border-border rounded-2xl shadow-xl px-4 py-3 text-sm">
      {summary.errors > 0 && (
        <span className="flex items-center gap-1.5 text-red-400 font-medium">
          <span aria-hidden="true">✕</span>
          {summary.errors} {summary.errors === 1 ? 'error' : 'errors'}
        </span>
      )}
      {summary.errors > 0 && summary.warnings > 0 && (
        <span className="text-white/20">·</span>
      )}
      {summary.warnings > 0 && (
        <span className="flex items-center gap-1.5 text-yellow-400 font-medium">
          <span aria-hidden="true">⚠</span>
          {summary.warnings} {summary.warnings === 1 ? 'warning' : 'warnings'}
        </span>
      )}
    </div>
  )
})

DiagnosticChip.displayName = 'DiagnosticChip'

// ---------------------------------------------------------------------------
// Stack — absolutely positioned above the timeline pill (bottom-right)
// ---------------------------------------------------------------------------

const NotificationStack = memo(() => {
  const toasts      = useNotificationStore(s => s.toasts)
  const dismissToast = useNotificationStore(s => s.dismissToast)

  return (
    <div
      className="absolute bottom-4 right-4 z-20 flex flex-col-reverse items-end gap-2 pointer-events-none"
      aria-live="polite"
      aria-label="Notifications"
    >
      {/* Toasts — rendered bottom-to-top via flex-col-reverse */}
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastCard toast={toast} onDismiss={() => dismissToast(toast.id)} />
        </div>
      ))}

      {/* Diagnostic summary always sits closest to the timeline */}
      <div className="pointer-events-auto">
        <DiagnosticChip />
      </div>
    </div>
  )
})

NotificationStack.displayName = 'NotificationStack'
export default NotificationStack
