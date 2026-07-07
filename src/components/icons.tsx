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

export const RedoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 0115-6.7L21 13" />
  </svg>
)

export const RotateIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 3v6h-6" />
    <path d="M21 9a9 9 0 10.5 4" />
  </svg>
)

export const SignatureIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 17c2-4 3.5-6 5-6s1.5 3 3 3 2.5-5 4-5 1 4 2.5 4 1.5-2 2.5-2" />
    <path d="M3 20h18" strokeOpacity={0.4} />
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

export const LockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </svg>
)

export const EyeOffIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.1A10.9 10.9 0 0112 5c5 0 9 4 10 7-.5 1.4-1.5 3-3 4.3M6.2 6.2C4 7.7 2.7 9.7 2 12c1 3 5 7 10 7 1.4 0 2.7-.3 3.9-.8" />
    <path d="M9.5 10a3 3 0 004 4" />
  </svg>
)

export const ZapIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
  </svg>
)

export const ExternalLinkIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14L21 3" />
  </svg>
)

/** The brand mark — same shape as public/favicon.svg, reused inline (not an
 * <img>) so it scales crisply and needs no extra request. */
export const LogoMark = (p: IconProps) => (
  <svg viewBox="0 0 32 32" aria-hidden {...p}>
    <rect width="32" height="32" rx="7" className="fill-ink-900" />
    <path
      d="M9 23c3-1 4-2 5.5-4.5S18 13 20 11l2-2 1 1-2 2c-2 2-3.5 4-5.5 5.5S12 21 9 23z"
      fill="white"
    />
  </svg>
)

export const ExpandIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 3H5a2 2 0 00-2 2v3" />
    <path d="M16 3h3a2 2 0 012 2v3" />
    <path d="M8 21H5a2 2 0 01-2-2v-3" />
    <path d="M16 21h3a2 2 0 002-2v-3" />
  </svg>
)
