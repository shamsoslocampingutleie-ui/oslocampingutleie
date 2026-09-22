#!/usr/bin/env python3
# One-off generator for the 4 missing host-acquisition ("lei ut X") landing
# pages: bobil, taktelt, tilhenger, maskiner. Follows the exact HTML/CSS
# structure of the 5 existing lei-ut-* pages (bil/bat/verktoy/fritidsutstyr/
# campingvogn) so the new pages are visually and structurally identical.
#
# Also patches the 5 existing pages' "Se hva andre leier ut" grid to link
# to the 4 new siblings, so internal link equity flows to them from day one.
#
# Run manually: python3 scripts/gen_lei_ut_pages.py

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")

CSS = """    *{box-sizing:border-box;margin:0;padding:0}
    :root{--g:#14512E;--gh:#1a6a3a;--bg:#f0f7f2}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222;line-height:1.65;background:#fff}
    header{background:var(--g);color:#fff;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px}
    .logo{color:#fff;text-decoration:none;font-weight:700;font-size:1.05rem}
    nav a{color:#c5e8ce;text-decoration:none;font-size:.9rem;margin-left:16px}
    nav a:hover{color:#fff}
    .hero{background:var(--bg);padding:52px 24px 44px;text-align:center}
    .hero h1{font-size:clamp(1.6rem,4vw,2.4rem);color:var(--g);line-height:1.25;margin-bottom:16px}
    .hero p.lead{font-size:1.1rem;color:#444;max-width:640px;margin:0 auto 28px}
    .btn{display:inline-block;background:var(--g);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:1.05rem}
    .btn:hover{background:var(--gh)}
    .trust{display:flex;justify-content:center;gap:20px;flex-wrap:wrap;margin-top:20px;font-size:.9rem;color:#555}
    .trust span::before{content:"✓ ";color:var(--g);font-weight:700}
    main{max-width:860px;margin:0 auto;padding:0 24px}
    section{padding:44px 0 8px}
    h2{font-size:1.45rem;color:var(--g);margin-bottom:18px;padding-bottom:10px;border-bottom:2px solid var(--bg)}
    p{color:#333;margin-bottom:12px}
    ul{padding-left:22px;margin-bottom:12px}
    li{color:#333;margin-bottom:6px}
    .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:18px;margin:20px 0}
    .step{background:var(--bg);padding:22px;border-radius:12px}
    .step .num{font-size:2rem;font-weight:800;color:var(--g);line-height:1}
    .step h3{font-size:1rem;margin:8px 0 4px;color:#111}
    .step p{font-size:.9rem;color:#555;margin:0}
    .first-badge{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1.5px solid var(--g);color:var(--g);border-radius:999px;padding:8px 18px;font-weight:700;font-size:.9rem;margin-bottom:18px}
    details{border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:10px}
    summary{font-weight:600;cursor:pointer;list-style:none;padding-right:24px;position:relative}
    summary::-webkit-details-marker{display:none}
    summary::after{content:"+";position:absolute;right:0;top:0;color:var(--g);font-size:1.2rem}
    details[open] summary::after{content:"−"}
    details[open] summary{color:var(--g);margin-bottom:10px}
    details p{color:#444;font-size:.95rem;margin:0}
    .cat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:20px 0}
    .cat{display:block;background:var(--bg);border:2px solid transparent;border-radius:10px;padding:16px;text-align:center;text-decoration:none;color:var(--g);font-weight:600;transition:border-color .2s}
    .cat:hover{border-color:var(--g)}
    .cta-box{background:var(--g);border-radius:14px;padding:36px;text-align:center;margin:44px 0;color:#fff}
    .cta-box h2{border:none;color:#fff;margin-bottom:12px}
    .cta-box p{color:#c5e8ce;margin-bottom:20px}
    .btn-light{display:inline-block;background:#fff;color:var(--g);padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1.05rem}
    .btn-light:hover{background:#f0f7f2}
    footer{background:#f5f5f5;padding:36px 24px;text-align:center;color:#666;font-size:.9rem;margin-top:56px}
    footer a{color:var(--g);text-decoration:none}
    .footer-links{display:flex;justify-content:center;gap:24px;flex-wrap:wrap;margin-bottom:16px}
    @media(max-width:600px){.steps{grid-template-columns:1fr}}"""

# All lei-ut-* categories, in the order the cross-link grid lists them.
# emoji/label match the convention already used by the 5 existing pages
# (bat/fritidsutstyr keep their existing emoji even though gen_seo_pages.py
# picked different ones for the renter-side pages — not worth churning
# already-indexed pages over a cosmetic mismatch).
ALL = [
    ("bil", "🚗", "bil"),
    ("bat", "🚢", "båt"),
    ("verktoy", "🔧", "verktøy"),
    ("fritidsutstyr", "🎣", "fritidsutstyr"),
    ("campingvogn", "🏕️", "campingvogn"),
    ("bobil", "🚐", "bobil"),
    ("taktelt", "⛺", "taktelt"),
    ("tilhenger", "🚚", "tilhenger"),
    ("maskiner", "🚜", "maskiner"),
]
NEW_SLUGS = ["bobil", "taktelt", "tilhenger", "maskiner"]

BROWSE_LINKS = """      <a class="cat" href="/leie-campingvogn-oslo">🏕 Campingvogner</a>
      <a class="cat" href="/leie-bobil-oslo">🚐 Bobiler</a>
      <a class="cat" href="/faq">❓ Spørsmål og svar</a>"""


def grid_html(self_slug):
    lines = [f'      <a class="cat" href="/lei-ut-{s}">{e} Lei ut {n}</a>' for s, e, n in ALL if s != self_slug]
    return "\n".join(lines) + "\n" + BROWSE_LINKS


# Category-specific content for the 4 new pages.
CONTENT = {
    "bobil": {
        "emoji": "🚐",
        "title": "Lei ut bobilen din | Tjen penger på Leieplattform",
        "meta": "Lei ut bobil gratis på Leieplattform. Bobiler leies typisk for 1000–3000 kr/dag. Du setter prisen, trygg betaling og digital kontrakt på alle leier.",
        "og_desc": "Lei ut bobilen gratis. Du setter prisen. Trygg betaling og digital kontrakt på alle leier.",
        "h1": "Lei ut bobilen din<br>— la den finansiere seg selv",
        "lead": "Står bobilen mesteparten av året uten å bli brukt? Forsikring og verditap løper uansett. Legg den ut gratis — du setter prisen, du godkjenner leietaker, og plattformen håndterer kontrakt, depositum og betaling.",
        "why": "Bobil er blant de mest etterspurte kategoriene å leie i Norge, og en av de dyreste eiendelene de fleste har stående store deler av året. Ved å leie ut noen uker i sesongen kan bobilen dekke en vesentlig del av egne kostnader — samtidig som all infrastruktur (digital kontrakt, depositum, Stripe-betaling) allerede er på plass fra dag én.",
        "items": ["Alkove", "Halvintegrert", "Helintegrert", "Campervan / minibobil"],
        "faq_extra": (
            "Hvem betaler for drivstoff og bomavgifter?",
            "Dette avtales mellom deg og leietaker og bør fremgå av annonsen — vanlig praksis er at leietaker fyller opp og betaler bomavgifter selv.",
        ),
    },
    "taktelt": {
        "emoji": "⛺",
        "title": "Lei ut taktelt | Bli først ute på Leieplattform",
        "meta": "Lei ut taktelt gratis på Leieplattform. Du setter prisen selv. Trygg betaling, digital kontrakt og depositum. Ingen konkurrerende annonser i kategorien ennå.",
        "og_desc": "Lei ut taktelt gratis. Du setter prisen. Trygg betaling og digital kontrakt på alle leier.",
        "h1": "Lei ut taktelt<br>— vær den første på Leieplattform",
        "lead": "Taktelt som står i garasjen mellom hver campingtur? Legg det ut gratis — du setter prisen, du godkjenner leietaker, og plattformen håndterer kontrakt og betaling.",
        "why": "Taktelt er en av de raskest voksende kategoriene innen friluftsliv i Norge, og kategorien er fortsatt ny på Leieplattform — det finnes ingen andre annonser å konkurrere med ennå. Det betyr at du blir det første, mest synlige alternativet for leietakere som søker i ditt område.",
        "items": ["Hardskall-taktelt", "Mykskall-taktelt", "Stige og monteringsutstyr", "Annekser og tilbehør"],
        "faq_extra": (
            "Må jeg montere teltet for leietaker?",
            "Nei, men mange utleiere tilbyr å vise montering ved henting første gang. Dette avtales og beskrives i annonsen.",
        ),
    },
    "tilhenger": {
        "emoji": "🚚",
        "title": "Lei ut tilhenger | Bli først ute på Leieplattform",
        "meta": "Lei ut tilhenger gratis på Leieplattform. Du setter prisen selv. Trygg betaling, digital kontrakt og depositum. Ingen konkurrerende annonser i kategorien ennå.",
        "og_desc": "Lei ut tilhenger gratis. Du setter prisen. Trygg betaling og digital kontrakt på alle leier.",
        "h1": "Lei ut tilhengeren din<br>— vær den første på Leieplattform",
        "lead": "En tilhenger som for det meste står parkert? Legg den ut gratis — du setter prisen, du godkjenner leietaker, og plattformen håndterer kontrakt og betaling.",
        "why": "Tilhenger er en av de mest utbredte, men minst utnyttede eiendelene i norske garasjer og gårdstun. Kategorien er fortsatt ny på Leieplattform — det finnes ingen andre annonser å konkurrere med ennå, så du blir det første, mest synlige alternativet for leietakere som søker i ditt område.",
        "items": ["Lukket tilhenger", "Åpen tilhenger", "Båttilhenger", "Bilhenger"],
        "faq_extra": (
            "Trenger leietaker spesiell førerkortklasse?",
            "For de fleste tilhengere med totalvekt under 750 kg holder vanlig førerkort klasse B. Sjekk vekt og krav for din tilhenger, og oppgi dette tydelig i annonsen.",
        ),
    },
    "maskiner": {
        "emoji": "🚜",
        "title": "Lei ut maskiner og utstyr | Tjen penger på Leieplattform",
        "meta": "Lei ut minigraver, hagemaskiner og annet utstyr gratis på Leieplattform. Maskiner leies ofte for 500–1500+ kr/dag. Du setter prisen selv, trygg betaling og digital kontrakt.",
        "og_desc": "Lei ut maskiner og utstyr gratis. Du setter prisen. Trygg betaling og digital kontrakt på alle leier.",
        "h1": "Lei ut maskiner og utstyr<br>— vær den første på Leieplattform",
        "lead": "Minigraver, hagemaskiner eller kompressor som står ubrukt mellom prosjekter? Legg det ut gratis — du setter prisen, du godkjenner leietaker, og plattformen håndterer kontrakt, depositum og betaling.",
        "why": "Maskiner og utstyr har blant de høyeste døgnprisene på Leieplattform, og kategorien er fortsatt ny — det finnes ingen andre annonser å konkurrere med ennå. Det gjør deg til det første, mest synlige alternativet for privatpersoner og småbedrifter som søker utstyr i ditt område.",
        "items": ["Minigravere og gravemaskiner", "Hagemaskiner", "Kompressorer og verktøy", "Lifter og stillas"],
        "faq_extra": (
            "Trenger leietaker opplæring eller sertifikat?",
            "For enkelt hageutstyr kreves normalt ingenting. For maskiner som krever førerbevis (f.eks. minigraver over en viss vekt) bør du selv vurdere leietakers erfaring før du godkjenner forespørselen.",
        ),
    },
}


def render_page(slug):
    c = CONTENT[slug]
    faq_extra_q, faq_extra_a = c["faq_extra"]

    faq_ld = ",\n      ".join([
        '{"@type": "Question","name": "Er det gratis å legge ut %s på Leieplattform?","acceptedAnswer": {"@type": "Answer", "text": "Ja, det er helt gratis å opprette profil og legge ut utstyr. Du betaler kun 10 %% plattformgebyr når du faktisk tjener penger på en godkjent og gjennomført leie."}}'
        % slug,
        '{"@type": "Question","name": "Hvorfor er det ingen andre annonser i denne kategorien ennå?","acceptedAnswer": {"@type": "Answer", "text": "Kategorien er ny på Leieplattform — det betyr du kan bli den første og synlige utleieren i ditt område, uten konkurranse fra andre annonser."}}',
        '{"@type": "Question","name": "Hva skjer hvis noe blir skadet?","acceptedAnswer": {"@type": "Answer", "text": "Alle leier kan inkludere depositum satt av deg som utleier. Depositumet holdes trygt på plattformen og frigis til deg ved godkjent skadeoppgjør."}}',
        '{"@type": "Question","name": "Hvem bestemmer prisen?","acceptedAnswer": {"@type": "Answer", "text": "Du som utleier setter prisen per dag, minimumsleieperiode og eventuelle tillegg. Du kan endre pris og tilgjengelighet når som helst."}}',
        '{"@type": "Question","name": "%s","acceptedAnswer": {"@type": "Answer", "text": "%s"}}' % (faq_extra_q, faq_extra_a),
    ])

    items_html = "\n      ".join(f"<li><strong>{item}</strong></li>" for item in c["items"])

    faq_html = f"""<details>
      <summary>Er det gratis å legge ut {slug} på Leieplattform?</summary>
      <p>Ja, det er helt gratis å opprette profil og legge ut utstyr. Du betaler kun 10 % plattformgebyr når du faktisk tjener penger på en gjennomført leie.</p>
    </details>
    <details>
      <summary>Hvorfor er det ingen andre annonser i denne kategorien ennå?</summary>
      <p>Kategorien er ny på Leieplattform — det betyr du kan bli den første og mest synlige utleieren i ditt område, uten konkurranse fra andre annonser.</p>
    </details>
    <details>
      <summary>Hva skjer hvis noe blir skadet?</summary>
      <p>Alle leier kan inkludere depositum satt av deg som utleier. Depositumet holdes trygt på plattformen. Ved skade dokumenterer du dette med bilder ved retur.</p>
    </details>
    <details>
      <summary>Hvem bestemmer prisen?</summary>
      <p>Du som utleier setter prisen per dag, minimumsleieperiode og eventuelle tillegg. Du kan endre pris og tilgjengelighet når som helst.</p>
    </details>
    <details>
      <summary>{faq_extra_q}</summary>
      <p>{faq_extra_a}</p>
    </details>"""

    return f"""<!doctype html>
<html lang="nb">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{c["title"]}</title>
  <meta name="description" content="{c["meta"]}" />
  <link rel="canonical" href="https://leieplattform.no/lei-ut-{slug}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta property="og:title" content="{c["title"]}" />
  <meta property="og:description" content="{c["og_desc"]}" />
  <meta property="og:url" content="https://leieplattform.no/lei-ut-{slug}" />
  <meta property="og:type" content="website" />
  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {faq_ld}
    ]
  }}
  </script>
  <style>
{CSS}
  </style>
</head>
<body>
<header>
  <a class="logo" href="/">Leieplattform</a>
  <nav>
    <a href="/leie-campingvogn-oslo">Lei campingvogn</a>
    <a href="/leie-bobil-oslo">Lei bobil</a>
    <a href="/bli-utleier">Bli utleier</a>
    <a href="/">Finn utstyr</a>
  </nav>
</header>

<div class="hero">
  <span class="first-badge">{c["emoji"]} Ny kategori — ingen konkurrerende annonser ennå</span>
  <h1>{c["h1"]}</h1>
  <p class="lead">{c["lead"]}</p>
  <a href="/" class="btn">Legg ut gratis →</a>
  <div class="trust">
    <span>Gratis å starte</span>
    <span>Du setter prisen selv</span>
    <span>Digital kontrakt automatisk</span>
    <span>Trygg betaling via Stripe</span>
  </div>
</div>

<main>
  <section>
    <h2>Hvorfor legge ut nå?</h2>
    <p>{c["why"]}</p>
  </section>

  <section>
    <h2>Slik fungerer utleie på Leieplattform</h2>
    <div class="steps">
      <div class="step">
        <div class="num">1</div>
        <h3>Opprett gratis profil</h3>
        <p>Registrer deg med e-post. Det tar under to minutter og er helt gratis.</p>
      </div>
      <div class="step">
        <div class="num">2</div>
        <h3>Legg ut annonse</h3>
        <p>Last opp bilder, beskriv utstyret, sett pris og velg tilgjengelighet i kalenderen.</p>
      </div>
      <div class="step">
        <div class="num">3</div>
        <h3>Godkjenn forespørsler</h3>
        <p>Motta forespørsler fra interesserte leietakere. Du velger selv hvem som får leie.</p>
      </div>
      <div class="step">
        <div class="num">4</div>
        <h3>Motta betaling</h3>
        <p>Kontrakt signeres digitalt. Betaling skjer via Stripe. Pengene utbetales etter gjennomført leie.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>Hva kan du leie ut?</h2>
    <ul>
      {items_html}
    </ul>
  </section>

  <section>
    <h2>Trygghet for utleier</h2>
    <p>Vi vet at du er glad i det du eier. Slik beskytter Leieplattform deg:</p>
    <ul>
      <li><strong>Verifiserte leietakere</strong> — alle brukere bekrefter e-post og er registrert med navn</li>
      <li><strong>Digital leieavtale</strong> — juridisk bindende digital kontrakt før hvert leieforhold</li>
      <li><strong>Depositum</strong> — du setter selv depositumets størrelse. Det holdes trygt til etter retur</li>
      <li><strong>Trygg betaling</strong> — betaling via Stripe, pengene frigis til deg etter godkjent retur</li>
      <li><strong>Meldingssystem</strong> — all kommunikasjon loggføres på plattformen</li>
    </ul>
  </section>

  <div class="cta-box">
    <h2>Klar til å bli den første?</h2>
    <p>Det er gratis å starte. Ingen bindingstid, ingen månedskostnad.</p>
    <a href="/" class="btn-light">Legg ut gratis →</a>
  </div>

  <section>
    <h2>Ofte stilte spørsmål</h2>
    {faq_html}
  </section>

  <section>
    <h2>Se hva andre leier ut</h2>
    <div class="cat-grid">
{grid_html(slug)}
    </div>
  </section>
</main>

<footer>
  <div class="footer-links">
    <a href="/">Hjem</a>
    <a href="/faq">FAQ</a>
    <a href="/bli-utleier">Bli utleier</a>
    <a href="/hjelp">Hjelp</a>
    <a href="/personvern">Personvern</a>
  </div>
  <p>© 2026 Leieplattform · Org.nr. 929 639 855 · <a href="/">leieplattform.no</a></p>
</footer>
</body>
</html>
"""


def write_new_pages():
    for slug in NEW_SLUGS:
        outdir = os.path.join(PUBLIC, f"lei-ut-{slug}")
        os.makedirs(outdir, exist_ok=True)
        outpath = os.path.join(outdir, "index.html")
        with open(outpath, "w", encoding="utf-8") as f:
            f.write(render_page(slug))
        print("wrote", outpath)


def patch_existing_pages():
    existing = ["bil", "bat", "verktoy", "fritidsutstyr", "campingvogn"]
    new_links = "\n".join(
        f'      <a class="cat" href="/lei-ut-{s}">{e} Lei ut {n}</a>' for s, e, n in ALL if s in NEW_SLUGS
    )
    for slug in existing:
        fpath = os.path.join(PUBLIC, f"lei-ut-{slug}", "index.html")
        s = open(fpath, encoding="utf-8").read()
        anchor = '      <a class="cat" href="/leie-campingvogn-oslo">🏕 Campingvogner</a>'
        if anchor not in s:
            print("SKIP (anchor not found):", fpath)
            continue
        if "/lei-ut-bobil" in s:
            print("SKIP (already patched):", fpath)
            continue
        s2 = s.replace(anchor, new_links + "\n" + anchor)
        open(fpath, "w", encoding="utf-8").write(s2)
        print("patched", fpath)


if __name__ == "__main__":
    write_new_pages()
    patch_existing_pages()
