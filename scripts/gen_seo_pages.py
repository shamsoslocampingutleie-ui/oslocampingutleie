#!/usr/bin/env python3
# One-off generator for local SEO landing pages. Run manually, not part of
# the build. Produces public/leie-{cat}-{city}/index.html for every
# missing (category, city) combination, following the exact HTML/CSS
# structure already established by the hand-built Oslo/Bergen pages.

import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")

# (slug, display name)
CITIES = [
    ("oslo", "Oslo"), ("bergen", "Bergen"), ("trondheim", "Trondheim"),
    ("stavanger", "Stavanger"), ("kristiansand", "Kristiansand"),
    ("jessheim", "Jessheim"), ("gardermoen", "Gardermoen"),
    ("drammen", "Drammen"), ("fredrikstad", "Fredrikstad"),
    ("sandnes", "Sandnes"), ("tromso", "Tromsø"),
    ("sarpsborg", "Sarpsborg"), ("skien", "Skien"),
    ("alesund", "Ålesund"), ("haugesund", "Haugesund"),
]

# category slug -> (display name, emoji)
ALL_CATS = [
    ("campingvogn", "Campingvogn", "🏕️"),
    ("bobil", "Bobil", "🚐"),
    ("taktelt", "Taktelt", "⛺"),
    ("tilhenger", "Tilhenger", "🚚"),
    ("maskiner", "Maskiner", "🚜"),
    ("bil", "Bil", "🚗"),
    ("bat", "Båt", "⛵"),
    ("verktoy", "Verktøy", "🔧"),
    ("fritidsutstyr", "Fritidsutstyr", "🏄"),
]
CAT_EMOJI = {slug: emoji for slug, _, emoji in ALL_CATS}
CAT_NAME = {slug: name for slug, name, _ in ALL_CATS}

# Content for the "light" template categories: price line, 4 "what can you
# rent" items, and 3 FAQ (question, answer) pairs. Shared across all 15
# cities for a category (matching the site's own existing pattern for
# taktelt/tilhenger/maskiner, where only Oslo/Bergen's flagship categories
# get bespoke per-city price tables and destinations).
LIGHT_CONTENT = {
    "taktelt": {
        "from_price": "190",
        "price_p": "Fra ca. 190 kr/dag. Prisen settes av den enkelte utleier og varierer etter type, størrelse og tilbehør. Aktuelle annonser på Leieplattform viser oppdaterte priser fra våre utleiere.",
        "items": [
            ("Hardskall-taktelt", "raskt å slå opp, robust i vind"),
            ("Mykskall-taktelt", "lettere og rimeligere i leie"),
            ("Stige og monteringsutstyr", "som regel inkludert"),
            ("Madrass og innredning", "sjekk annonsen for detaljer"),
        ],
        "faq": [
            ("Hva koster det å leie taktelt i {city}?", "Fra ca. 190 kr/dag. Prisen settes av den enkelte utleier og varierer med type og utstyr."),
            ("Kan jeg avbestille?", "Betingelser settes av utleier. De fleste tilbyr avbestilling inntil 48 timer før henting."),
            ("Hva skjer med depositumet?", "Frigis automatisk noen virkedager etter retur uten skader."),
        ],
    },
    "tilhenger": {
        "from_price": "250",
        "price_p": "Fra ca. 250 kr/dag. Prisen settes av den enkelte utleier og varierer etter type, størrelse og tilbehør. Aktuelle annonser på Leieplattform viser oppdaterte priser fra våre utleiere.",
        "items": [
            ("Lukket tilhenger", "for flytting og verdifullt gods"),
            ("Åpen tilhenger", "til hagearbeid og transport av løsmasser"),
            ("Båttilhenger", "tilpasset ulike båtstørrelser"),
            ("Bilhenger", "for transport av kjøretøy og maskiner"),
        ],
        "faq": [
            ("Hva koster det å leie tilhenger i {city}?", "Fra ca. 250 kr/dag. Prisen settes av den enkelte utleier og varierer med type og størrelse."),
            ("Kan jeg avbestille?", "Betingelser settes av utleier. De fleste tilbyr avbestilling inntil 48 timer før henting."),
            ("Hva skjer med depositumet?", "Frigis automatisk noen virkedager etter retur uten skader."),
        ],
    },
    "maskiner": {
        "from_price": None,
        "price_p": "Prisen settes av den enkelte utleier og varierer etter maskintype, alder og tilbehør. Aktuelle annonser på Leieplattform viser oppdaterte priser fra våre utleiere — sjekk gjeldende utvalg for nøyaktige tall.",
        "items": [
            ("Minigravere og gravemaskiner", "til hage- og anleggsarbeid"),
            ("Hagemaskiner", "plentraktorer, hekksakser, kantklippere"),
            ("Kompressorer og verktøy", "for bygg og vedlikehold"),
            ("Lifter og stillas", "for arbeid i høyden"),
        ],
        "faq": [
            ("Hva koster det å leie maskiner i {city}?", "Prisen settes av den enkelte utleier og varierer etter maskintype og utstyr."),
            ("Kan jeg avbestille?", "Betingelser settes av utleier. De fleste tilbyr avbestilling inntil 48 timer før henting."),
            ("Hva skjer med depositumet?", "Frigis automatisk noen virkedager etter retur uten skader."),
        ],
    },
    "bil": {
        "from_price": "450",
        "price_p": "Fra ca. 450 kr/dag. Prisen settes av den enkelte utleier og varierer etter bilmodell, drivstofftype og kilometergrense. Aktuelle annonser på Leieplattform viser oppdaterte priser fra våre utleiere.",
        "items": [
            ("Kompaktbil", "rimelig i by og til pendling"),
            ("Familiebil / stasjonsvogn", "god plass til bagasje"),
            ("Elbil", "lading ofte inkludert i prisen"),
            ("Varebil", "til flytting og transport av utstyr"),
        ],
        "faq": [
            ("Hva koster det å leie bil i {city}?", "Fra ca. 450 kr/dag. Prisen settes av den enkelte utleier og varierer med bilmodell og kilometergrense."),
            ("Er forsikring inkludert?", "De fleste utleiere har egen bilforsikring med en egenandel ved skade. Sjekk detaljene i annonsen før du booker."),
            ("Kan jeg avbestille?", "Betingelser settes av utleier. De fleste tilbyr avbestilling inntil 48 timer før henting."),
        ],
    },
    "bat": {
        "from_price": "690",
        "price_p": "Fra ca. 690 kr/dag. Prisen settes av den enkelte utleier og varierer etter båttype, motorstørrelse og utstyr. Aktuelle annonser på Leieplattform viser oppdaterte priser fra våre utleiere.",
        "items": [
            ("Jolle og robåt", "enkelt og rimelig for en fisketur"),
            ("Fritidsbåt med motor", "til dagsturer i skjærgården"),
            ("Cabincruiser", "med mulighet for overnatting om bord"),
            ("Seilbåt", "for deg med erfaring og seilbrev"),
        ],
        "faq": [
            ("Hva koster det å leie båt i {city}?", "Fra ca. 690 kr/dag. Prisen settes av den enkelte utleier og varierer med båttype og motorstørrelse."),
            ("Trenger jeg båtførerbevis?", "For båter med motor over 25 hk eller lengde over 8 meter kreves båtførerbevis. Sjekk kravene for den aktuelle båten i annonsen."),
            ("Kan jeg avbestille?", "Betingelser settes av utleier. De fleste tilbyr avbestilling inntil 48 timer før henting."),
        ],
    },
    "verktoy": {
        "from_price": "90",
        "price_p": "Fra ca. 90 kr/dag. Prisen settes av den enkelte utleier og varierer etter verktøytype og merke. Aktuelle annonser på Leieplattform viser oppdaterte priser fra våre utleiere.",
        "items": [
            ("Boremaskiner og elektroverktøy", "til de fleste hjemmeprosjekter"),
            ("Sag- og kappeutstyr", "for tre, metall og betong"),
            ("Malings- og pussutstyr", "sparkel, sliping og overflatebehandling"),
            ("Hageredskaper", "gressklippere, hekksakser og kantklippere"),
        ],
        "faq": [
            ("Hva koster det å leie verktøy i {city}?", "Fra ca. 90 kr/dag. Prisen settes av den enkelte utleier og varierer med verktøytype."),
            ("Hva skjer hvis verktøyet går i stykker?", "Leietaker er normalt ansvarlig for skader utover normal slitasje. Sjekk vilkårene i den enkelte annonse."),
            ("Kan jeg avbestille?", "Betingelser settes av utleier. De fleste tilbyr avbestilling inntil 48 timer før henting."),
        ],
    },
    "fritidsutstyr": {
        "from_price": "150",
        "price_p": "Fra ca. 150 kr/dag. Prisen settes av den enkelte utleier og varierer etter type utstyr og sesong. Aktuelle annonser på Leieplattform viser oppdaterte priser fra våre utleiere.",
        "items": [
            ("Sykler og el-sykler", "til bytur eller stitrimming"),
            ("Ski- og snowboardutstyr", "for vintersesongen"),
            ("Kajakk og SUP-brett", "for tur på sjø eller innsjø"),
            ("Telt og annet turutstyr", "for helgetur eller lengre fjelltur"),
        ],
        "faq": [
            ("Hva koster det å leie fritidsutstyr i {city}?", "Fra ca. 150 kr/dag. Prisen settes av den enkelte utleier og varierer med type utstyr og sesong."),
            ("Får jeg utstyret rengjort og klargjort?", "Ja, utstyret skal leveres rent og i god stand. Meld fra til utleier ved eventuelle mangler ved henting."),
            ("Kan jeg avbestille?", "Betingelser settes av utleier. De fleste tilbyr avbestilling inntil 48 timer før henting."),
        ],
    },
}

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
    footer{background:#f5f5f5;padding:36px 24px;text-align:center;color:#666;font-size:.9rem;margin-top:56px}
    footer a{color:var(--g);text-decoration:none}
    .footer-links{display:flex;justify-content:center;gap:24px;flex-wrap:wrap;margin-bottom:16px}
    .cta-box{background:var(--bg);border-radius:14px;padding:36px;text-align:center;margin:44px 0}
    .cta-box h2{border:none;margin-bottom:12px}
    @media(max-width:600px){.steps{grid-template-columns:1fr}}"""


def explore_grid(cur_cat, cur_city_slug):
    links = []
    for slug, name in CITIES:
        if slug == cur_city_slug:
            continue
        links.append(f'<a class="cat" href="/leie-{cur_cat}-{slug}">{CAT_EMOJI[cur_cat]} {name}</a>')
    for slug, name, emoji in ALL_CATS:
        if slug == cur_cat:
            continue
        links.append(f'<a class="cat" href="/leie-{slug}-{cur_city_slug}">{emoji} {name} {CITIES_DISPLAY[cur_city_slug]}</a>')
    links.append('<a class="cat" href="/bli-utleier">💰 Lei ut</a>')
    links.append('<a class="cat" href="/faq">❓ Ofte stilte spørsmål</a>')
    return "\n      ".join(links)


CITIES_DISPLAY = {slug: name for slug, name in CITIES}


def light_page(cat_slug, city_slug):
    city = CITIES_DISPLAY[city_slug]
    cat_name = CAT_NAME[cat_slug]
    cat_lower = cat_name.lower()
    content = LIGHT_CONTENT[cat_slug]
    from_price = content["from_price"]
    title_price = f" — fra {from_price} kr/dag" if from_price else ""
    title = f"Lei {cat_lower} i {city} 2026{title_price} | Leieplattform"
    desc = f"Finn {cat_lower} til leie i {city}-området fra verifiserte private utleiere. Digital kontrakt, trygg betaling og depositumsbeskyttelse."
    url = f"https://leieplattform.no/leie-{cat_slug}-{city_slug}"

    faq_ld = ",".join(
        '{"@type":"Question","name":"%s","acceptedAnswer":{"@type":"Answer","text":"%s"}}'
        % (q.format(city=city), a)
        for q, a in content["faq"]
    )

    items_html = "\n      ".join(
        f"<li><strong>{name}</strong> — {desc_}</li>" for name, desc_ in content["items"]
    )

    faq_html = "\n    ".join(
        f'<details>\n      <summary>{q.format(city=city)}</summary>\n      <p>{a}</p>\n    </details>'
        for q, a in content["faq"]
    )

    return f"""<!doctype html>
<html lang="nb">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <meta name="description" content="{desc}" />
  <link rel="canonical" href="{url}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{desc}" />
  <meta property="og:url" content="{url}" />
  <meta property="og:image" content="https://leieplattform.no/og-image.jpg" />
  <meta property="og:type" content="website" />
  <script type="application/ld+json">
  {{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{faq_ld}]}}
  </script>
  <style>
{CSS}
  </style>
</head>
<body>
<header>
  <a class="logo" href="/">Leieplattform</a>
  <nav>
    <a href="/leie-{cat_slug}-{city_slug}">{cat_name}</a>
    <a href="/leie-campingvogn-{city_slug}">Campingvogn</a>
    <a href="/bli-utleier">Bli utleier</a>
    <a href="/">Søk nå</a>
  </nav>
</header>
<div class="hero">
  <h1>Lei {cat_lower} i {city}
— direkte fra private eiere</h1>
  <p class="lead">{desc}</p>
  <a href="/" class="btn">Se {cat_lower} til leie →</a>
  <div class="trust">
    <span>Verifiserte utleiere</span><span>Digital leieavtale</span>
    <span>Trygg betaling via Stripe</span><span>Depositumsbeskyttelse</span>
  </div>
</div>
<main>
  <section>
    <h2>Slik leier du {cat_lower} i {city}</h2>
    <div class="steps">
      <div class="step"><div class="num">1</div><h3>Søk og velg</h3><p>Se tilgjengelig {cat_lower} med dine ønskede datoer.</p></div>
      <div class="step"><div class="num">2</div><h3>Send forespørsel</h3><p>Kontakt utleier direkte via meldingsfunksjonen.</p></div>
      <div class="step"><div class="num">3</div><h3>Signer avtale</h3><p>Digital leieavtale signeres av begge parter.</p></div>
      <div class="step"><div class="num">4</div><h3>Betal trygt</h3><p>Betaling via Stripe med depositumsbeskyttelse.</p></div>
    </div>
  </section>
  <section>
    <h2>Hva koster det å leie {cat_lower}?</h2>
    <p>{content["price_p"]}</p>
  </section>
  <section>
    <h2>Hva kan du leie?</h2>
    <ul>
      {items_html}
    </ul>
    <p>Utstyret eies og leies ut av private eiere i ditt område — sjekk hver annonse for nøyaktig spesifikasjon og hva som er inkludert.</p>
  </section>
  <div class="cta-box">
    <h2>Klar til å komme i gang?</h2>
    <p style="color:#444;margin-bottom:20px">Se tilgjengelig {cat_lower} i {city} og bestill direkte.</p>
    <a href="/" class="btn">Se {cat_lower} til leie →</a>
  </div>
  <section>
    <h2>Ofte stilte spørsmål</h2>
    {faq_html}
  </section>
  <section>
    <h2>Utforsk mer</h2>
    <div class="cat-grid">
      {explore_grid(cat_slug, city_slug)}
    </div>
  </section>
</main>
<footer>
  <div class="footer-links">
    <a href="/">Hjem</a><a href="/faq">FAQ</a><a href="/bli-utleier">Bli utleier</a><a href="/hjelp">Hjelp</a><a href="/personvern">Personvern</a>
  </div>
  <p>© 2026 Leieplattform · Org.nr. 929 639 855 · <a href="/">leieplattform.no</a></p>
</footer>
</body>
</html>
"""


def write_page(cat_slug, city_slug, html):
    d = os.path.join(PUBLIC, f"leie-{cat_slug}-{city_slug}")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "index.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    return path


if __name__ == "__main__":
    created = []
    for cat_slug in LIGHT_CONTENT:
        for city_slug, _ in CITIES:
            d = os.path.join(PUBLIC, f"leie-{cat_slug}-{city_slug}")
            if os.path.exists(d):
                continue
            html = light_page(cat_slug, city_slug)
            path = write_page(cat_slug, city_slug, html)
            created.append(path)
    print(f"Created {len(created)} pages")
    for p in created:
        print(" ", p.replace(PUBLIC + "/", ""))
