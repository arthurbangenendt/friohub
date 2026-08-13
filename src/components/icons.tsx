import type { SVGProps } from "react";

// Ícones de linha, 24×24, stroke currentColor. Consistentes em todo o sistema.
type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 24, ...props }: P) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

// Marca — fluxo de ar / clima
export const Logo = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 8h11a3 3 0 1 0-3-3" />
    <path d="M3 12h15a3 3 0 1 1-3 3" />
    <path d="M3 16h9a2.5 2.5 0 1 1-2.5 2.5" />
  </svg>
);

// Instalação de ar novo (fluxo de ar)
export const Wind = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8h11a2.5 2.5 0 1 0-2.5-2.5" />
    <path d="M4 12h15a2.5 2.5 0 1 1-2.5 2.5" />
    <path d="M4 16h8a2 2 0 1 1-2 2" />
  </svg>
);

export const Wrench = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.5 6.5a3.5 3.5 0 0 1-4.6 4.6L5 16v3h3l4.9-4.9a3.5 3.5 0 0 0 4.6-4.6l-2.1 2.1-2.1-.4-.4-2.1 2.1-2.1a3.5 3.5 0 0 0-.5.9Z" />
  </svg>
);

export const Droplet = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3s5.5 5.5 5.5 9.5a5.5 5.5 0 0 1-11 0C6.5 8.5 12 3 12 3Z" />
  </svg>
);

export const Move = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 9 2 12l3 3" />
    <path d="M9 5l3-3 3 3" />
    <path d="M15 19l3 3 3-3" />
    <path d="M19 9l3 3-3 3" />
    <path d="M2 12h20" />
    <path d="M12 2v20" />
  </svg>
);

export const Tool = (p: P) => (
  <svg {...base(p)}>
    <path d="M15 7a3 3 0 0 1 3 3l3-3-1.5-1.5a4.2 4.2 0 0 0-6 6L4 19l1 1 7.5-7.5" />
    <path d="M6.5 17.5 5 19" />
  </svg>
);

export const Check = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const ArrowRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

export const Star = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? "currentColor" : "none"}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 17l-5.3 2.6 1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />
  </svg>
);

export const Shield = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const MapPin = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z" />
    <circle cx="12" cy="11" r="2.2" />
  </svg>
);

export const Building = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
    <path d="M15 9h2a2 2 0 0 1 2 2v10" />
    <path d="M9 7h2M9 11h2M9 15h2" />
    <path d="M4 21h16" />
  </svg>
);

export const User = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
  </svg>
);

export const Bolt = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </svg>
);

export const Bell = (p: P) => (
  <svg {...base(p)}>
    <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8Z" />
    <path d="M10 21h4" />
  </svg>
);

export const Search = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4-4" />
  </svg>
);

export const Doc = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

export const Chat = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.7L3 21l1.9-5A8.2 8.2 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z" />
  </svg>
);
