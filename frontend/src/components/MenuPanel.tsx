import { memo } from 'react'

type Props = {
  isOpen: boolean
  onClose: () => void
}

const MenuPanel = memo(({ isOpen, onClose }: Props) => {
  return (
    <aside
      className={[
        'absolute left-3 top-4 bottom-4 w-72 bg-panel border border-border rounded-3xl shadow-xl flex flex-col overflow-hidden',
        'transition-transform duration-[250ms] ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-[calc(100%+1rem)]',
      ].join(' ')}
    >
      <div className="flex items-center justify-between px-4 py-4 border-b border-border shrink-0">
        <span className="text-sm font-semibold text-white">Menu</span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white text-lg leading-none ml-2"
          aria-label="Close menu"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto">

        {/* Import */}
        <section className="px-4 py-4 border-b border-border">
          <p className="text-[10px] uppercase tracking-wider text-white/30 mb-3">Import</p>
          <button
            disabled
            className="w-full text-left px-3 py-2.5 rounded bg-white/5 text-white/40 text-sm cursor-not-allowed"
          >
            Import LTG file
            <span className="block text-[10px] text-white/25 mt-0.5">Coming soon</span>
          </button>
        </section>

        {/* Visual Editor */}
        <section className="px-4 py-4">
          <p className="text-[10px] uppercase tracking-wider text-white/30 mb-3">Visual Editor</p>
          <button
            disabled
            className="w-full text-left px-3 py-2.5 rounded bg-white/5 text-white/40 text-sm cursor-not-allowed"
          >
            Open visual editor
            <span className="block text-[10px] text-white/25 mt-0.5">Coming soon</span>
          </button>
        </section>

      </div>
    </aside>
  )
})

MenuPanel.displayName = 'MenuPanel'
export default MenuPanel
