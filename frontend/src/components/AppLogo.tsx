interface AppLogoProps {
  size?: number;
  style?: React.CSSProperties;
  id?: string;
}

export default function AppLogo({ size = 32, style, id = 'logo' }: AppLogoProps) {
  const gradId = `${id}-bg`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', ...style }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7C5CFC" />
          <stop offset="1" stopColor="#5B3FD4" />
        </linearGradient>
      </defs>
      {/* Rounded square background */}
      <rect width="32" height="32" rx="8" fill={`url(#${gradId})`} />
      {/* Open book — left page */}
      <path
        d="M15.5 8.5C15.5 8.5 13 9.5 9 9.5V22.5C13 22.5 15.5 21.5 15.5 21.5"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Open book — right page */}
      <path
        d="M16.5 8.5C16.5 8.5 19 9.5 23 9.5V22.5C19 22.5 16.5 21.5 16.5 21.5"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Spine highlight */}
      <line x1="16" y1="8" x2="16" y2="22" stroke="white" strokeWidth="1.2" opacity="0.4" />
      {/* Pencil tip — correction symbol */}
      <path
        d="M20.5 12.5L23 10"
        stroke="#52C41A"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M21.5 13.5L23 10L19.5 11.5"
        stroke="#52C41A"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
