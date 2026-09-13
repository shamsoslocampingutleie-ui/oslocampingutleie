const SUPABASE_URL = 'https://cglxodxiqpzrgwrfaqbr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yypSMj_dG7_yfOmJO9ZZmA_CrrnMmgW';

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export default async function handler(req, res) {
  const id = req.query.id;
  if (!id || id.length < 10) return res.redirect(302, '/');

  // Serve the same rich-preview HTML (with a same-page JS redirect) to every
  // visitor, bot or human. Branching this on User-Agent used to be textbook
  // cloaking -- Google's own crawler matched the bot regex and got this
  // page, while every real visitor was silently redirected elsewhere before
  // ever seeing it. Serving one document to everyone keeps social-preview
  // scrapers (which don't run JS) and Googlebot (which does) both happy,
  // without treating any visitor differently.
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}&select=id,title,description,price_per_day,location,images&status=eq.active&limit=1`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const [listing] = await r.json();
    if (!listing) return res.redirect(302, '/');

    const title = `${listing.title} — Leieplattform`;
    const desc = listing.description
      ? `${listing.description.slice(0, 155)} — ${listing.price_per_day} kr/dag`
      : `Lei for ${listing.price_per_day} kr/dag. Finn campingvogn, bobil, taktelt og mer på Leieplattform.`;
    const image = (listing.images || [])[0] || 'https://leieplattform.no/og-image.jpg';
    const url = `https://leieplattform.no/listing/${id}`;

    const html = `<!DOCTYPE html><html lang="nb"><head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
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
</head><body>
<script>window.location.replace("/?listing=${id}")</script>
<p><a href="/?listing=${id}">${esc(listing.title)}</a> — ${esc(desc)}</p>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).send(html);
  } catch {
    return res.redirect(302, `/?listing=${id}`);
  }
}
