// Animated SVG scene: bus takes wrong route, ETA fails.
// Exports: render(targetElement) — no dependencies.

const ANIMATION_DURATION = 6000;

export function render(targetEl) {
  if (!targetEl) return;

  targetEl.innerHTML = `
    <svg viewBox="0 0 480 160" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;border-radius:8px">
      <!-- Sky gradient -->
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0f1729"/>
          <stop offset="100%" stop-color="#1a2744"/>
        </linearGradient>
        <linearGradient id="road" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1e293b"/>
          <stop offset="100%" stop-color="#334155"/>
        </linearGradient>
      </defs>

      <!-- Sky background -->
      <rect width="480" height="160" fill="url(#sky)"/>

      <!-- Stars -->
      <circle cx="40" cy="20" r="1.5" fill="white" opacity="0.6"/>
      <circle cx="90" cy="35" r="1" fill="white" opacity="0.4"/>
      <circle cx="160" cy="15" r="1.2" fill="white" opacity="0.5"/>
      <circle cx="210" cy="30" r="0.8" fill="white" opacity="0.3"/>
      <circle cx="320" cy="18" r="1.5" fill="white" opacity="0.6"/>
      <circle cx="400" cy="28" r="1" fill="white" opacity="0.4"/>
      <circle cx="440" cy="12" r="1.2" fill="white" opacity="0.5"/>

      <!-- Buildings silhouette -->
      <rect x="0" y="60" width="60" height="60" fill="#0d1320" rx="2"/>
      <rect x="10" y="70" width="10" height="10" fill="#fbbf24" opacity="0.6"/>
      <rect x="30" y="75" width="8" height="8" fill="#fbbf24" opacity="0.4"/>
      <rect x="70" y="45" width="50" height="75" fill="#0d1320" rx="2"/>
      <rect x="80" y="55" width="8" height="8" fill="#fbbf24" opacity="0.5"/>
      <rect x="95" y="60" width="8" height="8" fill="#fbbf24" opacity="0.3"/>
      <rect x="80" y="72" width="8" height="8" fill="#fbbf24" opacity="0.6"/>
      <rect x="350" y="50" width="45" height="70" fill="#0d1320" rx="2"/>
      <rect x="360" y="60" width="8" height="8" fill="#fbbf24" opacity="0.4"/>
      <rect x="375" y="65" width="8" height="8" fill="#fbbf24" opacity="0.6"/>
      <rect x="400" y="55" width="80" height="65" fill="#0d1320" rx="2"/>
      <rect x="410" y="65" width="8" height="8" fill="#fbbf24" opacity="0.5"/>
      <rect x="425" y="70" width="8" height="8" fill="#fbbf24" opacity="0.3"/>
      <rect x="440" y="60" width="8" height="8" fill="#fbbf24" opacity="0.7"/>

      <!-- Road -->
      <rect x="0" y="120" width="480" height="40" fill="url(#road)"/>

      <!-- Correct route (dashed, light blue) -->
      <line id="correct-route" x1="30" y1="140" x2="450" y2="140"
            stroke="#60a5fa" stroke-width="3" stroke-dasharray="10,6"
            opacity="0.5"/>

      <!-- Wrong route (red, dashed) -->
      <path id="wrong-route" d="M 30 140 L 200 140 L 220 160 L 280 160 L 300 140 L 450 140"
            stroke="#f87171" stroke-width="3" stroke-dasharray="10,6"
            fill="none" opacity="0.8"/>

      <!-- Route labels -->
      <text x="240" y="138" text-anchor="middle" fill="#60a5fa" font-size="10" font-family="monospace">正确路线</text>
      <text x="250" y="158" text-anchor="middle" fill="#f87171" font-size="10" font-family="monospace" opacity="0.8">走错路线 ↓</text>

      <!-- Bus SVG group (animated along wrong route) -->
      <g id="bus-group" transform="translate(0,0)">
        <!-- Bus body -->
        <rect x="0" y="0" width="56" height="28" rx="6" fill="#fbbf24"/>
        <!-- Windows -->
        <rect x="4" y="4" width="12" height="10" rx="2" fill="#0f172a" opacity="0.8"/>
        <rect x="20" y="4" width="12" height="10" rx="2" fill="#0f172a" opacity="0.8"/>
        <rect x="36" y="4" width="12" height="10" rx="2" fill="#0f172a" opacity="0.8"/>
        <!-- Route number -->
        <rect x="4" y="16" width="22" height="8" rx="2" fill="#0f172a"/>
        <text x="15" y="23" text-anchor="middle" fill="#fbbf24" font-size="7" font-weight="bold" font-family="sans-serif">271B</text>
        <!-- Wheels -->
        <circle cx="14" cy="28" r="5" fill="#1e293b"/>
        <circle cx="14" cy="28" r="2.5" fill="#64748b"/>
        <circle cx="42" cy="28" r="5" fill="#1e293b"/>
        <circle cx="42" cy="28" r="2.5" fill="#64748b"/>
      </g>

      <!-- Bus stop marker (destination) -->
      <rect x="430" y="112" width="20" height="8" rx="2" fill="#60a5fa"/>
      <rect x="435" y="108" width="10" height="6" fill="#60a5fa"/>
      <text x="440" y="118" text-anchor="middle" fill="white" font-size="7" font-family="monospace">站</text>

      <!-- ETA display (fails) -->
      <g id="eta-display" transform="translate(340, 78)">
        <rect width="120" height="36" rx="6" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>
        <text x="10" y="14" fill="#94a3b8" font-size="8" font-family="monospace">ETA</text>
        <text id="eta-time" x="10" y="28" fill="#60a5fa" font-size="14" font-weight="bold" font-family="monospace">08:32</text>
      </g>

      <!-- Alert badge -->
      <g id="alert-badge" transform="translate(420, 74)" opacity="0">
        <circle r="10" fill="#f87171"/>
        <text x="0" y="4" text-anchor="middle" fill="white" font-size="14" font-weight="bold">!</text>
      </g>

      <!-- Timeline text -->
      <text id="timeline" x="240" y="155" text-anchor="middle" fill="#94a3b8" font-size="11" font-family="monospace">08:15 · 偏离路线</text>
    </svg>

    <style>
      @keyframes bus-move {
        0%   { transform: translate(30px, 140px); }
        25%  { transform: translate(200px, 140px); }
        45%  { transform: translate(220px, 160px); }
        65%  { transform: translate(280px, 160px); }
        80%  { transform: translate(300px, 140px); }
        100% { transform: translate(390px, 140px); }
      }
      @keyframes eta-fail {
        0%, 35%  { fill: #60a5fa; }
        36%, 44% { fill: #f87171; }
        45%, 55% { fill: #60a5fa; }
        56%, 65% { fill: #f87171; }
        66%, 75% { fill: #60a5fa; }
        76%, 84% { fill: #f87171; }
        85%, 100% { fill: #f87171; }
      }
      @keyframes alert-pop {
        0%, 80%  { opacity: 0; transform: translate(420px, 74px) scale(0); }
        85%, 95% { opacity: 1; transform: translate(420px, 74px) scale(1.2); }
        100%     { opacity: 1; transform: translate(420px, 74px) scale(1); }
      }
      @keyframes timeline-fail {
        0%, 30%  { fill: #94a3b8; }
        31%, 100%{ fill: #f87171; }
      }
      @keyframes wrong-route-flash {
        0%, 100% { opacity: 0.8; }
        50% { opacity: 1; stroke-dashoffset: 0; }
      }
      #bus-group {
        animation: bus-move ${ANIMATION_DURATION}ms ease-in-out infinite;
      }
      #eta-time {
        animation: eta-fail ${ANIMATION_DURATION}ms ease-in-out infinite;
      }
      #alert-badge {
        animation: alert-pop ${ANIMATION_DURATION}ms ease-out infinite;
        transform-origin: 430px 84px;
      }
      #timeline {
        animation: timeline-fail ${ANIMATION_DURATION}ms ease-in-out infinite;
      }
      #wrong-route {
        animation: wrong-route-flash 2s ease-in-out infinite;
      }
    </style>
  `;
}