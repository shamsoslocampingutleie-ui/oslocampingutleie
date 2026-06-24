// Dynamic OG image — returns an SVG branded for Leieplattform.
// Facebook/Instagram require PNG; we redirect to a static fallback for bots
// that don't support SVG, and serve SVG for all others.
// For best social sharing: upload a proper PNG to /public/og-leieplattform.png

export const config = { runtime: 'edge' };

export default function handler(req) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d3b23"/>
      <stop offset="100%" stop-color="#14512E"/>
    </linearGradient>
    <clipPath id="round"><rect width="1200" height="630" rx="0"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <!-- Decorative circles -->
  <circle cx="980" cy="120" r="220" fill="#ffffff" fill-opacity="0.05"/>
  <circle cx="1100" cy="500" r="160" fill="#ffffff" fill-opacity="0.04"/>
  <circle cx="100" cy="550" r="180" fill="#ffffff" fill-opacity="0.04"/>
  <!-- Logo mark -->
  <circle cx="140" cy="140" r="52" fill="#ffffff" fill-opacity="0.12"/>
  <text x="140" y="155" font-family="system-ui,-apple-system,sans-serif" font-size="44" text-anchor="middle" fill="#ffffff">⛺</text>
  <!-- Brand name -->
  <text x="220" y="162" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="28" font-weight="700" fill="#ffffff" letter-spacing="3" text-transform="uppercase" opacity="0.7">LEIEPLATTFORM.NO</text>
  <!-- Main headline -->
  <text x="100" y="320" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="72" font-weight="800" fill="#ffffff" letter-spacing="-1">Lei og lei ut</text>
  <text x="100" y="410" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="72" font-weight="800" fill="#ffffff" letter-spacing="-1">over hele Norge</text>
  <!-- Subtext -->
  <text x="100" y="490" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="30" fill="#ffffff" opacity="0.75">Campingvogn · Bobil · Taktelt · Utstyr og mer</text>
  <!-- Trust badges -->
  <rect x="100" y="535" width="200" height="48" rx="24" fill="#ffffff" fill-opacity="0.15"/>
  <text x="200" y="566" font-family="system-ui,-apple-system,sans-serif" font-size="20" text-anchor="middle" fill="#ffffff" font-weight="600">✓ Trygt</text>
  <rect x="318" y="535" width="240" height="48" rx="24" fill="#ffffff" fill-opacity="0.15"/>
  <text x="438" y="566" font-family="system-ui,-apple-system,sans-serif" font-size="20" text-anchor="middle" fill="#ffffff" font-weight="600">✓ Forsikret</text>
  <rect x="576" y="535" width="260" height="48" rx="24" fill="#ffffff" fill-opacity="0.15"/>
  <text x="706" y="566" font-family="system-ui,-apple-system,sans-serif" font-size="20" text-anchor="middle" fill="#ffffff" font-weight="600">✓ Fra 290 kr/dag</text>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
