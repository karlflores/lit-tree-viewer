import { useEffect } from 'react'

type Props = {
  title: string
  message: string
  confirmLabel?: string
  discardLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onDiscard: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Save',
  discardLabel = 'Discard',
  cancelLabel  = 'Cancel',
  onConfirm,
  onDiscard,
  onCancel,
}: Props) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-panel border border-border rounded-2xl shadow-2xl w-80 flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="text-xs text-white/50 leading-relaxed">{message}</p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={onConfirm}
            className="w-full py-2 rounded-lg text-xs font-semibold bg-white text-surface hover:bg-white/90 transition-colors"
          >
            {confirmLabel}
          </button>
          <button
            onClick={onDiscard}
            className="w-full py-2 rounded-lg text-xs font-medium text-red-400/80 hover:text-red-400 hover:bg-red-400/10 border border-transparent hover:border-red-400/20 transition-colors"
          >
            {discardLabel}
          </button>
          <button
            onClick={onCancel}
            className="w-full py-2 rounded-lg text-xs font-medium text-white/40 hover:text-white hover:bg-white/5 transition-colors"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
