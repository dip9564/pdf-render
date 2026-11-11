import { cn } from '@/lib/utils';

interface WaveBackgroundProps {
  /**
   * 'hero': Prominent upper hero framing + subtle lower homepage continuation.
   * 'subtle': Quiet architectural corner waves for inner tool pages so workspaces stay calm.
   */
  variant?: 'hero' | 'subtle';
  className?: string;
}

export function WaveBackground({ variant = 'hero', className }: WaveBackgroundProps) {
  const isHero = variant === 'hero';

  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none select-none absolute inset-0 overflow-hidden z-0',
        className
      )}
    >
      {/* ==================== UPPER ARCHITECTURAL WAVES ==================== */}
      <div
        className={cn(
          'absolute inset-x-0 top-0 w-full',
          isHero
            ? 'h-[430px] sm:h-[490px] lg:h-[540px] opacity-[0.82] dark:opacity-[0.80]'
            : 'h-[250px] sm:h-[300px] opacity-45 dark:opacity-45'
        )}
        style={{
          WebkitMaskImage:
            'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.92) 55%, rgba(0,0,0,0) 100%)',
          maskImage:
            'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.92) 55%, rgba(0,0,0,0) 100%)',
        }}
      >
        {/* LIGHT THEME WAVES (Warm Beige + Soft Ivory + Lavender Grey + Muted Blue-Grey) */}
        <svg
          viewBox="0 0 1440 560"
          preserveAspectRatio="xMidYMin slice"
          className="block dark:hidden w-full h-full"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="lw-beige-sweep" x1="0%" y1="0%" x2="75%" y2="85%">
              <stop offset="0%" stopColor="#D8C5AC" stopOpacity="0.88" />
              <stop offset="52%" stopColor="#EAE2D7" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#F5F1EA" stopOpacity="0.15" />
            </linearGradient>

            <linearGradient id="lw-ivory-fold" x1="8%" y1="0%" x2="62%" y2="95%">
              <stop offset="0%" stopColor="#EAE2D7" stopOpacity="0.94" />
              <stop offset="60%" stopColor="#F5F1EA" stopOpacity="0.82" />
              <stop offset="100%" stopColor="#FAF9F6" stopOpacity="0.12" />
            </linearGradient>

            <linearGradient id="lw-lavender-sweep" x1="100%" y1="8%" x2="22%" y2="96%">
              <stop offset="0%" stopColor="#AAB4C8" stopOpacity="0.72" />
              <stop offset="48%" stopColor="#A6A5BC" stopOpacity="0.58" />
              <stop offset="86%" stopColor="#EAE2D7" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#F5F1EA" stopOpacity="0" />
            </linearGradient>

            <linearGradient id="lw-bluegrey-fold" x1="100%" y1="30%" x2="36%" y2="100%">
              <stop offset="0%" stopColor="#A6A5BC" stopOpacity="0.55" />
              <stop offset="45%" stopColor="#AAB4C8" stopOpacity="0.46" />
              <stop offset="82%" stopColor="#4F46E5" stopOpacity="0.045" />
              <stop offset="100%" stopColor="#F5F1EA" stopOpacity="0" />
            </linearGradient>

            <linearGradient id="lw-rim-warm" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
              <stop offset="65%" stopColor="#FAF9F6" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#FAF9F6" stopOpacity="0" />
            </linearGradient>

            <linearGradient id="lw-rim-cool" x1="100%" y1="0%" x2="15%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.82" />
              <stop offset="55%" stopColor="#E5E7EB" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#4F46E5" stopOpacity="0.08" />
            </linearGradient>

            <filter id="lw-paper-shadow" x="-10%" y="-10%" width="120%" height="125%">
              <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#6B5E4C" floodOpacity="0.06" />
            </filter>
            <filter id="lw-cool-shadow" x="-10%" y="-10%" width="120%" height="125%">
              <feDropShadow dx="-4" dy="8" stdDeviation="14" floodColor="#475569" floodOpacity="0.05" />
            </filter>
          </defs>

          {/* Left upper warm beige folded sheet */}
          <path
            d="M -60 -20 L 470 -20 C 485 110 385 215 240 285 C 125 340 30 390 -60 470 Z"
            fill="url(#lw-beige-sweep)"
            filter="url(#lw-paper-shadow)"
          />
          <path
            d="M 470 -20 C 485 110 385 215 240 285 C 125 340 30 390 -60 470"
            stroke="url(#lw-rim-warm)"
            strokeWidth="1.6"
          />

          {/* Secondary soft ivory overlap curve (center-left depth) */}
          <path
            d="M -60 120 C 80 120 285 95 455 15 C 615 -60 725 30 620 145 C 510 265 255 310 -60 495 Z"
            fill="url(#lw-ivory-fold)"
            opacity="0.85"
            filter="url(#lw-paper-shadow)"
          />
          <path
            d="M 620 145 C 510 265 255 310 -60 495"
            stroke="url(#lw-rim-warm)"
            strokeWidth="1.3"
          />

          {/* Right upper cool lavender-grey sculptural wave */}
          <path
            d="M 1500 -20 L 940 -20 C 980 85 1105 145 1035 230 C 950 335 760 355 595 490 L 1500 490 Z"
            fill="url(#lw-lavender-sweep)"
            filter="url(#lw-cool-shadow)"
          />
          <path
            d="M 940 -20 C 980 85 1105 145 1035 230 C 950 335 760 355 595 490"
            stroke="url(#lw-rim-cool)"
            strokeWidth="1.5"
          />

          {/* Foreground subtle blue-grey & hint of indigo ribbon */}
          <path
            d="M 1500 135 C 1320 205 1185 280 1075 390 C 985 480 895 520 790 560 L 1500 560 Z"
            fill="url(#lw-bluegrey-fold)"
            filter="url(#lw-cool-shadow)"
          />
          <path
            d="M 1500 135 C 1320 205 1185 280 1075 390 C 985 480 895 520 790 560"
            stroke="url(#lw-rim-cool)"
            strokeWidth="1.25"
          />
        </svg>

        {/* DARK THEME WAVES (Deep Charcoal + Midnight Blue + Deep Indigo + Muted Lavender Edge) */}
        <svg
          viewBox="0 0 1440 560"
          preserveAspectRatio="xMidYMin slice"
          className="hidden dark:block w-full h-full"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="dw-midnight-sweep" x1="0%" y1="0%" x2="80%" y2="85%">
              <stop offset="0%" stopColor="#17172C" stopOpacity="0.96" />
              <stop offset="48%" stopColor="#312E81" stopOpacity="0.46" />
              <stop offset="100%" stopColor="#0B0D18" stopOpacity="0.05" />
            </linearGradient>

            <linearGradient id="dw-indigo-fold" x1="12%" y1="0%" x2="68%" y2="95%">
              <stop offset="0%" stopColor="#17172C" stopOpacity="0.88" />
              <stop offset="58%" stopColor="#312E81" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#0B0D18" stopOpacity="0" />
            </linearGradient>

            <linearGradient id="dw-violet-sweep" x1="100%" y1="8%" x2="22%" y2="96%">
              <stop offset="0%" stopColor="#312E81" stopOpacity="0.58" />
              <stop offset="45%" stopColor="#17172C" stopOpacity="0.82" />
              <stop offset="85%" stopColor="#0B0D18" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#0B0D18" stopOpacity="0" />
            </linearGradient>

            <linearGradient id="dw-violet-ribbon" x1="100%" y1="25%" x2="36%" y2="100%">
              <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.24" />
              <stop offset="45%" stopColor="#312E81" stopOpacity="0.32" />
              <stop offset="90%" stopColor="#0B0D18" stopOpacity="0" />
            </linearGradient>

            <linearGradient id="dw-lavender-rim-left" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#818CF8" stopOpacity="0.52" />
              <stop offset="50%" stopColor="#4F46E5" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#312E81" stopOpacity="0" />
            </linearGradient>

            <linearGradient id="dw-lavender-rim-right" x1="100%" y1="0%" x2="18%" y2="100%">
              <stop offset="0%" stopColor="#818CF8" stopOpacity="0.58" />
              <stop offset="48%" stopColor="#4F46E5" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#17172C" stopOpacity="0" />
            </linearGradient>

            <filter id="dw-depth-shadow" x="-10%" y="-10%" width="120%" height="125%">
              <feDropShadow dx="0" dy="10" stdDeviation="14" floodColor="#04050C" floodOpacity="0.50" />
            </filter>
          </defs>

          {/* Left upper deep indigo/midnight folded ribbon */}
          <path
            d="M -60 -20 L 470 -20 C 485 110 385 215 240 285 C 125 340 30 390 -60 470 Z"
            fill="url(#dw-midnight-sweep)"
            filter="url(#dw-depth-shadow)"
          />
          <path
            d="M 470 -20 C 485 110 385 215 240 285 C 125 340 30 390 -60 470"
            stroke="url(#dw-lavender-rim-left)"
            strokeWidth="1.25"
          />

          {/* Secondary midnight curved layer */}
          <path
            d="M -60 120 C 80 120 285 95 455 15 C 615 -60 725 30 620 145 C 510 265 255 310 -60 495 Z"
            fill="url(#dw-indigo-fold)"
            filter="url(#dw-depth-shadow)"
          />
          <path
            d="M 620 145 C 510 265 255 310 -60 495"
            stroke="url(#dw-lavender-rim-left)"
            strokeWidth="1.15"
            opacity="0.78"
          />

          {/* Right upper architectural indigo sweep */}
          <path
            d="M 1500 -20 L 940 -20 C 980 85 1105 145 1035 230 C 950 335 760 355 595 490 L 1500 490 Z"
            fill="url(#dw-violet-sweep)"
            filter="url(#dw-depth-shadow)"
          />
          <path
            d="M 940 -20 C 980 85 1105 145 1035 230 C 950 335 760 355 595 490"
            stroke="url(#dw-lavender-rim-right)"
            strokeWidth="1.35"
          />

          {/* Subtle violet lower fold edge */}
          <path
            d="M 1500 135 C 1320 205 1185 280 1075 390 C 985 480 895 520 790 560 L 1500 560 Z"
            fill="url(#dw-violet-ribbon)"
            filter="url(#dw-depth-shadow)"
          />
          <path
            d="M 1500 135 C 1320 205 1185 280 1075 390 C 985 480 895 520 790 560"
            stroke="url(#dw-lavender-rim-right)"
            strokeWidth="1.1"
            opacity="0.72"
          />
        </svg>

        {/* Soft center pocket radial vignette so hero headline and search stay razor-sharp */}
        {isHero && (
          <div
            className="absolute inset-0 bg-[radial-gradient(ellipse_72%_74%_at_50%_40%,rgba(245,241,234,0.92)_0%,rgba(245,241,234,0.46)_58%,rgba(245,241,234,0)_100%)] dark:bg-[radial-gradient(ellipse_72%_74%_at_50%_40%,rgba(11,13,24,0.88)_0%,rgba(11,13,24,0.40)_58%,rgba(11,13,24,0)_100%)]"
          />
        )}
      </div>

      {/* ==================== LOWER CONTINUATION WAVE (HOMEPAGE ONLY) ==================== */}
      {isHero && (
        <div
          className="absolute inset-x-0 bottom-0 h-[220px] sm:h-[260px] w-full opacity-55 dark:opacity-55"
          style={{
            WebkitMaskImage:
              'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.65) 55%, rgba(0,0,0,0) 100%)',
            maskImage:
              'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.65) 55%, rgba(0,0,0,0) 100%)',
          }}
        >
          {/* Light bottom continuation */}
          <svg
            viewBox="0 0 1440 260"
            preserveAspectRatio="xMidYMax slice"
            className="block dark:hidden w-full h-full"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="lw-bottom-beige" x1="0%" y1="100%" x2="70%" y2="0%">
                <stop offset="0%" stopColor="#D8C5AC" stopOpacity="0.55" />
                <stop offset="60%" stopColor="#EAE2D7" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#F5F1EA" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="lw-bottom-lav" x1="100%" y1="100%" x2="25%" y2="0%">
                <stop offset="0%" stopColor="#AAB4C8" stopOpacity="0.45" />
                <stop offset="55%" stopColor="#A6A5BC" stopOpacity="0.32" />
                <stop offset="100%" stopColor="#F5F1EA" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M -40 260 L -40 120 C 180 75 385 155 620 205 C 830 248 1060 220 1280 260 Z"
              fill="url(#lw-bottom-beige)"
            />
            <path
              d="M -40 120 C 180 75 385 155 620 205 C 830 248 1060 220 1280 260"
              stroke="#FFFFFF"
              strokeOpacity="0.65"
              strokeWidth="1.25"
            />
            <path
              d="M 1480 260 L 1480 85 C 1220 95 1020 175 760 220 C 590 250 440 255 320 260 Z"
              fill="url(#lw-bottom-lav)"
            />
            <path
              d="M 1480 85 C 1220 95 1020 175 760 220 C 590 250 440 255 320 260"
              stroke="#FFFFFF"
              strokeOpacity="0.55"
              strokeWidth="1.2"
            />
          </svg>

          {/* Dark bottom continuation */}
          <svg
            viewBox="0 0 1440 260"
            preserveAspectRatio="xMidYMax slice"
            className="hidden dark:block w-full h-full"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id="dw-bottom-indigo" x1="0%" y1="100%" x2="70%" y2="0%">
                <stop offset="0%" stopColor="#17172C" stopOpacity="0.88" />
                <stop offset="55%" stopColor="#312E81" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#0B0D18" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="dw-bottom-violet" x1="100%" y1="100%" x2="25%" y2="0%">
                <stop offset="0%" stopColor="#312E81" stopOpacity="0.45" />
                <stop offset="55%" stopColor="#17172C" stopOpacity="0.72" />
                <stop offset="100%" stopColor="#0B0D18" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M -40 260 L -40 120 C 180 75 385 155 620 205 C 830 248 1060 220 1280 260 Z"
              fill="url(#dw-bottom-indigo)"
            />
            <path
              d="M -40 120 C 180 75 385 155 620 205 C 830 248 1060 220 1280 260"
              stroke="#818CF8"
              strokeOpacity="0.26"
              strokeWidth="1.15"
            />
            <path
              d="M 1480 260 L 1480 85 C 1220 95 1020 175 760 220 C 590 250 440 255 320 260 Z"
              fill="url(#dw-bottom-violet)"
            />
            <path
              d="M 1480 85 C 1220 95 1020 175 760 220 C 590 250 440 255 320 260"
              stroke="#818CF8"
              strokeOpacity="0.3"
              strokeWidth="1.15"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
