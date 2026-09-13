const SUPABASE_URL = 'https://cglxodxiqpzrgwrfaqbr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yypSMj_dG7_yfOmJO9ZZmA_CrrnMmgW';

const CAT_LABEL = {
  camping: 'Campingvogn',
  mobil: 'Bobil',
  tent: 'Taktelt',
  trailer: 'Tilhenger',
  boat: 'Båt',
  car: 'Bil',
  tool: 'Verktøy',
  fritid: 'Fritidsutstyr',
  maskiner: 'Maskiner',
};

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export default async function handler(req, res) {
  const id = req.query.id;
  if (!id || id.length < 10) return res.redirect(302, '/');

  // Serve the same content to every visitor, bot or human -- no User-Agent
  // branching (that was cloaking). The HTML body below is real, substantive
  // listing content so Googlebot's initial HTML-only crawl pass already has
  // something to index at the canonical /listing/{id} URL, without waiting
  // on a render pass. A visitor whose browser runs JS gets progressively
  // carried into the full interactive app (booking, chat, etc.) via the
  // redirect at the bottom; one that doesn't (or a scraper that never runs
  // JS) still sees a complete, readable page instead of a bare fragment.
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}&select=id,title,description,price_per_day,deposit,location,images,category,specs,feats,min_days,rating,reviews_count&status=eq.active&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const [listing] = await r.json();
    if (!listing) return res.redirect(302, '/');

    const catLabel = CAT_LABEL[listing.category] || listing.category || '';
    const title = `${listing.title} — Leieplattform`;
    const desc = listing.description
      ? `${listing.description.slice(0, 155)} — ${listing.price_per_day} kr/dag`
      : `Lei for ${listing.price_per_day} kr/dag. Finn campingvogn, bobil, taktelt og mer på Leieplattform.`;
    const images = (listing.images || []).slice(0, 6);
    const image = images[0] || 'https://leieplattform.no/og-image.jpg';
    const url = `https://leieplattform.no/listing/${id}`;
    const specs = [...(listing.specs || []), ...(listing.feats || [])];

    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: listing.title,
      description: listing.description || desc,
      category: catLabel || undefined,
      image: images.length ? images : undefined,
      brand: { '@type': 'Organization', name: 'Leieplattform' },
      offers: {
        '@type': 'Offer',
        priceCurrency: 'NOK',
        price: listing.price_per_day,
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: listing.price_per_day,
          priceCurrency: 'NOK',
          unitText: 'dag',
        },
        availability: 'https://schema.org/InStock',
        url,
      },
      ...(listing.reviews_count > 0
        ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: listing.rating, reviewCount: listing.reviews_count } }
        : {}),
    };

    const html = `<!DOCTYPE html><html lang="nb"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="product">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Leieplattform">
<meta property="og:locale" content="nb_NO">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(url)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
body{font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#1a2b20;line-height:1.5}
a{color:#14512e}
h1{font-size:26px;margin:12px 0 4px}
.meta{color:#555;font-size:14px;margin-bottom:16px}
.price{font-size:20px;font-weight:700;margin:12px 0}
img{max-width:100%;border-radius:12px;margin-bottom:8px}
.imgs{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
ul{padding-left:20px}
.back{display:inline-block;margin-top:20px;font-weight:600}
.desc{white-space:pre-line}
</style>
</head><body>
<p><a href="/">← Leieplattform</a></p>
<h1>${esc(listing.title)}</h1>
<p class="meta">${esc(listing.location || '')}${catLabel ? ' · ' + esc(catLabel) : ''}${listing.min_days ? ' · min. ' + listing.min_days + ' dager' : ''}</p>
<div class="imgs">${images.map(src => `<img src="${esc(src)}" alt="${esc(listing.title)}" loading="lazy">`).join('')}</div>
<p class="price">${listing.price_per_day} kr/dag${listing.deposit ? ' · depositum ' + listing.deposit + ' kr' : ''}</p>
<p class="desc">${esc(listing.description || '')}</p>
${specs.length ? `<ul>${specs.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
<a class="back" href="/">Se flere annonser på Leieplattform →</a>
<script>window.location.replace("/?listing=${id}")</script>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).send(html);
  } catch {
    return res.redirect(302, `/?listing=${id}`);
  }
}
