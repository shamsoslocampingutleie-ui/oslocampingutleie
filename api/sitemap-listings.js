// Dynamic sitemap for individual listing pages. The static
// public/sitemap.xml only lists the 144 fixed city/category landing
// pages -- every active listing (its own indexable, crawlable page
// via api/og.js, with real Product structured data) was completely
// absent from any sitemap, meaning Google had no direct signal to
// discover or re-crawl them, only indirect discovery via on-site links
// from the homepage grid. On a small, new site that direct signal
// matters. Generated on request (not a static file) since listings
// change constantly; cached briefly at the edge.
const SUPABASE_URL = 'https://cglxodxiqpzrgwrfaqbr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yypSMj_dG7_yfOmJO9ZZmA_CrrnMmgW';

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default async function handler(req, res) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?select=id,created_at&status=eq.active&order=created_at.desc&limit=5000`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    const listings = await r.json();
    const urls = (Array.isArray(listings) ? listings : []).map((l) => {
      const lastmod = (l.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      return `  <url><loc>https://leieplattform.no/listing/${esc(l.id)}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
    return res.status(200).send(xml);
  } catch {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n');
  }
}
