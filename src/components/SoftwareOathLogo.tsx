import type { CSSProperties, SVGProps } from "react";

interface SoftwareOathLogoProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  variant?: "mark" | "badge" | "full";
  className?: string;
  style?: CSSProperties;
}

/**
 * Software Oath Brand Mark & Logo
 * Design: The Cryptographic Razor Shield
 * - Left wing: Dark metallic titanium steel
 * - Right wing: Electric neon lime (#b9e63f)
 * - Center: Interlocking Merkle proof diamond
 */
export function SoftwareOathLogo({
  size = 28,
  variant = "mark",
  className = "",
  style,
  ...props
}: SoftwareOathLogoProps) {
  if (variant === "full") {
    const height = size;

    return (
      <div
        className={`software-oath-brand-lockup ${className}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "10px",
          ...style,
        }}
      >
        <SoftwareOathLogo size={height} variant="mark" {...props} />
        <span
          style={{
            fontSize: typeof size === "number" ? Math.max(14, size * 0.6) : "1rem",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            color: "var(--text, #f3f4ef)",
            whiteSpace: "nowrap",
            lineHeight: 1,
          }}
        >
          Software Oath
        </span>
      </div>
    );
  }

  if (variant === "badge") {
    return (
      <svg
        aria-label="Software Oath App Icon"
        className={className}
        height={size}
        style={style}
        viewBox="0 0 512 512"
        width={size}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <defs>
          <linearGradient id="so-bg" x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#141819" />
            <stop offset="50%" stopColor="#0b0e0f" />
            <stop offset="100%" stopColor="#050607" />
          </linearGradient>
          <linearGradient id="so-sq-border" x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#b9e63f" stopOpacity="0.8" />
            <stop offset="30%" stopColor="#2d373a" />
            <stop offset="70%" stopColor="#182022" />
            <stop offset="100%" stopColor="#b9e63f" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="so-lime-wing" x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#e3ff75" />
            <stop offset="50%" stopColor="#b9e63f" />
            <stop offset="100%" stopColor="#88c50e" />
          </linearGradient>
          <linearGradient id="so-titanium-wing" x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#2c3639" />
            <stop offset="50%" stopColor="#1c2325" />
            <stop offset="100%" stopColor="#0f1415" />
          </linearGradient>
          <radialGradient cx="60%" cy="46%" id="so-glow" r="55%">
            <stop offset="0%" stopColor="#b9e63f" stopOpacity="0.25" />
            <stop offset="60%" stopColor="#b9e63f" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#b9e63f" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect fill="url(#so-bg)" height="476" rx="112" stroke="url(#so-sq-border)" strokeWidth="3.5" width="476" x="18" y="18" />
        <circle cx="280" cy="246" fill="url(#so-glow)" r="175" />

        <path
          d="M 242 78 L 124 136 C 124 290 182 394 242 444 Z"
          fill="url(#so-titanium-wing)"
          stroke="#333e41"
          strokeWidth="2.5"
        />

        <path
          d="M 270 78 L 388 136 C 388 290 330 394 270 444 Z"
          fill="url(#so-lime-wing)"
        />

        <g transform="translate(256, 260)">
          <polygon fill="#050607" points="0,-38 38,0 0,38 -38,0" />
          <polygon fill="#ffffff" points="0,-24 24,0 0,24 -24,0" />
          <polygon fill="url(#so-lime-wing)" points="0,-12 12,0 0,12 -12,0" />
        </g>
      </svg>
    );
  }

  // "mark" (Transparent Background Vector Shield Logo)
  return (
    <svg
      aria-label="Software Oath Icon"
      className={className}
      height={size}
      style={style}
      viewBox="0 0 512 512"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <defs>
        <linearGradient id="mark-lime" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#e3ff75" />
          <stop offset="50%" stopColor="#b9e63f" />
          <stop offset="100%" stopColor="#88c50e" />
        </linearGradient>
        <linearGradient id="mark-dark" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#2c3639" />
          <stop offset="50%" stopColor="#1c2325" />
          <stop offset="100%" stopColor="#0f1415" />
        </linearGradient>
      </defs>

      <path
        d="M 242 78 L 124 136 C 124 290 182 394 242 444 Z"
        fill="url(#mark-dark)"
        stroke="#333e41"
        strokeWidth="3"
      />

      <path
        d="M 270 78 L 388 136 C 388 290 330 394 270 444 Z"
        fill="url(#mark-lime)"
      />

      <g transform="translate(256, 260)">
        <polygon fill="#050607" points="0,-38 38,0 0,38 -38,0" />
        <polygon fill="#ffffff" points="0,-24 24,0 0,24 -24,0" />
        <polygon fill="url(#mark-lime)" points="0,-12 12,0 0,12 -12,0" />
      </g>
    </svg>
  );
}

export default SoftwareOathLogo;
