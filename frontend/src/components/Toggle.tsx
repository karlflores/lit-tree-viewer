type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

const Toggle = ({ checked, onChange, label }: Props) => (
  <label className="flex items-center gap-2.5 cursor-pointer select-none group">
    <span className="text-xs text-white/40 group-hover:text-white/60 transition-colors">
      {label}
    </span>
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        'relative inline-flex h-[20px] w-9 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none',
        checked
          ? 'bg-white/15 border-white/25'
          : 'bg-transparent border-border hover:border-white/20',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-3 w-3 rounded-full shadow-sm transition-transform duration-200',
          checked
            ? 'translate-x-[19px] bg-white'
            : 'translate-x-[3px] bg-white/30',
        ].join(' ')}
      />
    </button>
  </label>
)

export default Toggle
