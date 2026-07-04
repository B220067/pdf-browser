import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function base(props: IconProps): IconProps {
  return {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props,
  }
}

export const CursorIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 3l14 8-6.5 1.5L9 19 5 3z" />
  </svg>
)

export const TypeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7V4h16v3" />
    <path d="M12 4v16" />
    <path d="M8 20h8" />
  </svg>
)

export const PenIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <path d="M2 2l7.586 7.586" />
    <circle cx="11" cy="11" r="2" />
  </svg>
)

export const EraserIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 20H8.5l-4.2-4.2a1.7 1.7 0 010-2.4L14.6 3.1a1.7 1.7 0 012.4 0l4.9 4.9a1.7 1.7 0 010 2.4L13 19.3" />
    <path d="M10.5 7.5l6 6" />
  </svg>
)

export const UndoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 00-15-6.7L3 13" />
  </svg>
)

export const DownloadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
)

export const TrashIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)

export const GripIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="9" cy="6" r="1" fill="currentColor" />
    <circle cx="15" cy="6" r="1" fill="currentColor" />
    <circle cx="9" cy="12" r="1" fill="currentColor" />
    <circle cx="15" cy="12" r="1" fill="currentColor" />
    <circle cx="9" cy="18" r="1" fill="currentColor" />
    <circle cx="15" cy="18" r="1" fill="currentColor" />
  </svg>
)

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const MinusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
)

export const FileIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" />
    <path d="M14 2v6h6" />
  </svg>
)
