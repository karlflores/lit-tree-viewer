import { memo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  hidden?: boolean
}

// Generic layout container for the left-side tool strip.
// Slides off-screen to the left when a left-side panel is open.
const SideToolbar = memo(({ children, hidden = false }: Props) => (
  <div
    className={[
      'absolute left-2 top-2 z-10 flex flex-col gap-2 pointer-events-none',
      'transition-transform duration-[250ms] ease-in-out',
      hidden ? '-translate-x-[calc(100%+0.5rem)]' : 'translate-x-0',
    ].join(' ')}
  >
    {children}
  </div>
))

SideToolbar.displayName = 'SideToolbar'
export default SideToolbar
