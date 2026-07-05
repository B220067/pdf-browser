import { PRESET_COLORS } from '../types'

interface ColorSwatchesProps {
  value: string
  onChange: (color: string) => void
  /** Compact fits the dark text-box chip; regular fits the toolbar. */
  size?: 'regular' | 'compact'
  ariaLabel: string
}

/**
 * One-click preset colors plus a native color-wheel input for custom picks.
 * Used everywhere a color can be chosen (text, pen, signature) so the
 * palette stays consistent.
 */
export function ColorSwatches({ value, onChange, size = 'regular', ariaLabel }: ColorSwatchesProps) {
  const swatchClass = size === 'compact' ? 'h-5 w-5' : 'h-7 w-7'
  const wheelClass = size === 'compact' ? 'h-6 w-7' : 'h-8 w-9'
  const isPreset = PRESET_COLORS.some((c) => c.toLowerCase() === value.toLowerCase())

  return (
    <div className="flex items-center gap-1" role="group" aria-label={ariaLabel}>
      {PRESET_COLORS.map((color) => {
        const selected = color.toLowerCase() === value.toLowerCase()
        return (
          <button
            key={color}
            type="button"
            title={color}
            aria-pressed={selected}
            onClick={() => onChange(color)}
            className={`${swatchClass} rounded-full border transition-transform hover:scale-110 ${
              selected
                ? 'border-white ring-2 ring-sky-400'
                : 'border-black/20'
            }`}
            style={{ backgroundColor: color }}
          />
        )
      })}
      <input
        type="color"
        value={value}
        title="Custom color"
        aria-label={`${ariaLabel}: custom`}
        onChange={(e) => onChange(e.target.value)}
        className={`${wheelClass} cursor-pointer rounded border p-0.5 ${
          !isPreset ? 'border-sky-400 ring-1 ring-sky-400' : 'border-slate-300'
        } bg-white`}
      />
    </div>
  )
}
