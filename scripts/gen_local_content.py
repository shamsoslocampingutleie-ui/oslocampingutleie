#!/usr/bin/env python3
# Adds a genuine, researched local-content section to the "light template"
# category pages (taktelt, tilhenger, maskiner, bil, bat, verktoy,
# fritidsutstyr) across all 15 cities -- these previously shared identical,
# non-localized body copy (only the city name differed). Campingvogn and
# Bobil are untouched here; their heavier per-city template already has
# real content for most cities.
#
# Inserted as a new <section> right after "Hva kan du leie?" / "Hva koster",
# before the CTA box. Idempotent: replaces its own marker block if re-run.

import os, re, glob

PUBLIC = "public"

# Real, checkable facts about each city -- used to build genuinely
# different content per page, not just a name swap.
CITY_FACTS = {
    "oslo": {
        "trips": [("Nordmarka", "20 min", "tur-, sykkel- og skiterreng rett utenfor byen"),
                   ("Hurdalsjøen", "45 min", "bading, kanopadling og fiske"),
                   ("Rondane", "ca. 3 t", "fjell og villreinterreng")],
        "waters": [("Oslofjorden", "øyer og badeplasser som Hovedøya og Langøyene rett utenfor sentrum"),
                    ("Tyrifjorden", "rolig innsjøpadling og fiske ca. 45 min unna")],
        "summer": "padletur i Oslofjorden eller sykkeltur i Nordmarka",
        "winter": "langrenn i Nordmarka eller alpint på Tryvann",
        "terrain": "Oslo har alt fra flate boligfelt til bratte skråninger mot Nordmarka, og etterspørselen etter hageredskaper og mindre gravemaskiner er høyest vår og høst.",
    },
    "bergen": {
        "trips": [("Hardangerfjorden", "ca. 2 t", "fjord, fossefall og fruktbygder"),
                   ("Sognefjorden", "ca. 2,5 t", "Norges lengste og dypeste fjord"),
                   ("Voss", "ca. 1 t", "fjell, ekstremsport og skianlegg")],
        "waters": [("Byfjorden og Askøy", "skjærgård rett utenfor sentrum"),
                    ("Hardangerfjorden", "populær for lengre båtturer sørover")],
        "summer": "kajakktur i Byfjorden eller dagstur til øyene utenfor",
        "winter": "alpint i Voss eller Myrkdalen, drøyt en times kjøring unna",
        "terrain": "Bergen ligger mellom syv fjell med bratt terreng og mye nedbør, noe som gjør pumper, kompressorer og solid hageutstyr til noe av det mest etterspurte.",
    },
    "trondheim": {
        "trips": [("Oppdal", "ca. 1,5 t", "fjell, villmark og skianlegg"),
                   ("Hitra og Frøya", "ca. 1,5 t", "kystfiske og øyliv"),
                   ("Røros", "ca. 2,5 t", "verdensarv-bergstad")],
        "waters": [("Trondheimsfjorden", "rolig fjordfarvann rett ved byen"),
                    ("Hitra/Frøya-farvannet", "kjent for godt havfiske")],
        "summer": "havfisketur på Trondheimsfjorden eller tur til Hitra/Frøya",
        "winter": "langrenn i Bymarka eller alpint i Oppdal",
        "terrain": "Trondheim har store studentbefolkningsflytninger vår og høst, som gjør tilhenger og flyttegrei ekstra populært i de periodene.",
    },
    "stavanger": {
        "trips": [("Lysefjorden og Preikestolen", "ca. 1 t", "Norges mest kjente fjordutsikt"),
                   ("Jærstrendene", "20–30 min", "lange sandstrender som Sola og Borestranden"),
                   ("Ryfylke", "ca. 1–2 t", "fjorder og fjell")],
        "waters": [("Lysefjorden", "dramatisk fjord med fossefall"),
                    ("Jærkysten", "åpent farvann og lange strender")],
        "summer": "seiltur i Ryfylke eller surfing på Jærstrendene",
        "winter": "fjelltur i Ryfylke (mildere vintre enn innlandet)",
        "terrain": "Stavanger-regionen har mye flatt jordbruksland på Jæren, der større hagemaskiner og gravemaskiner er ettertraktet blant både bønder og hobbyhagefolk.",
    },
    "kristiansand": {
        "trips": [("Sørlandets skjærgård", "0–30 min", "hvite trebyer og tusenvis av holmer"),
                   ("Setesdal", "ca. 1,5 t", "fjelldaler og elvepadling"),
                   ("Lindesnes", "ca. 1 t", "Norges sørligste punkt")],
        "waters": [("Sørlandets skjærgård", "en av Norges mest populære farvann for fritidsbåt"),
                    ("Topdalsfjorden", "rolig padling nær sentrum")],
        "summer": "dagstur i skjærgården — en av landets mest populære båtdestinasjoner",
        "winter": "skitur i Sirdal, ca. 1,5 time unna",
        "terrain": "Kristiansand har mildt sørlandsklima, og hageredskaper er i bruk store deler av året sammenlignet med resten av landet.",
    },
    "jessheim": {
        "trips": [("Hurdalsjøen", "20 min", "bading og kanopadling"),
                   ("Oslo sentrum", "40 min", "byliv og kultur"),
                   ("Gjøvik/Mjøsa", "ca. 1 t", "Norges største innsjø")],
        "waters": [("Hurdalsjøen", "en av regionens fineste innsjøer for padling og fiske")],
        "summer": "kanopadling på Hurdalsjøen",
        "winter": "langrenn i marka rundt Hurdal og Nannestad",
        "terrain": "Romerike rundt Jessheim er dominert av flatt jordbruksland, og etterspørselen etter tilhengere og traktorredskap følger onnene om våren og høsten.",
    },
    "gardermoen": {
        "trips": [("Oslo sentrum", "45 min", "byliv og kultur"),
                   ("Hurdalsjøen", "25 min", "bading og friluftsliv"),
                   ("Mjøsa", "ca. 1 t", "Norges største innsjø")],
        "waters": [("Hurdalsjøen", "nærmeste innsjø for padling og fiske")],
        "summer": "kort avstikker til Hurdalsjøen mellom fly og henting",
        "winter": "langrenn i Nordmarka, ca. 45 min unna",
        "terrain": "Gardermoen-området er praktisk som hente-/leveringspunkt for de som skal videre til hytte eller flyplass med campingvogn eller bobil.",
    },
    "drammen": {
        "trips": [("Kongsberg", "ca. 45 min", "sølvgruver, fjell og skianlegg"),
                   ("Skrimfjella", "ca. 45 min", "tur og villmark"),
                   ("Numedal", "ca. 1,5 t", "fjelldal og elvepadling")],
        "waters": [("Drammensfjorden", "fjordfarvann rett ved byen"),
                    ("Tyrifjorden og Randsfjorden", "innsjøer i kort avstand for padling og fiske")],
        "summer": "padletur på Drammensfjorden eller Tyrifjorden",
        "winter": "alpint på Kongsberg Skisenter, ca. 45 min unna",
        "terrain": "Drammen ligger i et av landets villeste elveløp (Drammenselva), noe som gjør båt- og fritidsutstyr populært både sommer og vinter.",
    },
    "fredrikstad": {
        "trips": [("Hvaler", "ca. 30 min", "Norges mest besøkte skjærgårdsdestinasjon"),
                   ("Gamlebyen Fredrikstad", "rett i sentrum", "Nord-Europas best bevarte festningsby"),
                   ("Halden", "ca. 45 min", "grensehandel og festning")],
        "waters": [("Hvaler-skjærgården", "et av Norges mest populære farvann for fritidsbåt"),
                    ("Glomma", "Norges lengste elv, rett gjennom byen")],
        "summer": "båttur i Hvaler-skjærgården",
        "winter": "islagt vann i Glomma-vassdraget for skøytetur enkelte år",
        "terrain": "Fredrikstad og Østfold har flatt terreng godt egnet for hageredskaper og tilhengertransport til Hvaler i sommersesongen.",
    },
    "sandnes": {
        "trips": [("Jærstrendene", "15–20 min", "lange sandstrender"),
                   ("Lysefjorden", "ca. 1 t", "fjord og Preikestolen"),
                   ("Ryfylke", "ca. 1–2 t", "fjorder og fjell")],
        "waters": [("Jærkysten", "åpent farvann, kjent blant surfere og fiskere"),
                    ("Gandsfjorden", "rolig fjordarm rett ved byen")],
        "summer": "surfing på Jærstrendene eller tur i Gandsfjorden",
        "winter": "fjelltur i Ryfylke",
        "terrain": "Sandnes ligger midt på Jæren med noe av Norges mest produktive jordbruksland, og etterspørselen etter maskiner og tilhengere følger sesongene i landbruket.",
    },
    "tromso": {
        "trips": [("Lyngenalpene", "ca. 2 t", "bratte alpetopper rett fra fjorden"),
                   ("Sommarøy", "ca. 1 t", "hvite strender under midnattssol"),
                   ("Senja", "ca. 3 t", "dramatisk kystnatur")],
        "waters": [("Tromsøysundet", "fjordfarvann med hvalsafari og fiske"),
                    ("Lyngenfjorden", "kjent for både fjording og skiing rett ned til sjøen")],
        "summer": "fisketur eller hvalsafari i fjorden under midnattssol",
        "winter": "toppturski i Lyngenalpene og nordlysjakt",
        "terrain": "Tromsø har lange, mørke vintre og kort, intens sommer, og etterspørselen etter fritidsutstyr svinger kraftig med sesongen — skiutstyr om vinteren, kajakk og sykkel om sommeren.",
    },
    "sarpsborg": {
        "trips": [("Hvaler", "ca. 30 min", "skjærgård og badeliv"),
                   ("Oldtidsveien", "rett ved byen", "Nord-Europas tetteste samling helleristninger"),
                   ("Strömstad, Sverige", "ca. 45 min", "svenskehandel og skjærgård")],
        "waters": [("Glomma og Sarpsfossen", "Norges kraftigste foss midt i byen"),
                    ("Hvaler-skjærgården", "kort tur unna for båtliv")],
        "summer": "padletur på Glomma eller båttur til Hvaler",
        "winter": "skitur i skogene rundt Sarpsborg",
        "terrain": "Sarpsborg ligger i et av landets viktigste jordbruksdistrikt, og maskiner og tilhengere er i høy sesong under våronn og innhøsting.",
    },
    "skien": {
        "trips": [("Telemarkskanalen", "rett fra byen", "en av Norges mest kjente kanalstrekninger"),
                   ("Gaustatoppen", "ca. 1 t", "Sør-Norges høyeste fjell med vidsyn over store deler av landet"),
                   ("Bø Sommarland", "ca. 30 min", "Norges største badeland")],
        "waters": [("Telemarkskanalen", "rolig kanal- og innsjøfarvann ideelt for båt"),
                    ("Norsjø", "stor innsjø med gode fiskeforhold")],
        "summer": "kanaltur på Telemarkskanalen eller fisketur på Norsjø",
        "winter": "skitur på Gaustatoppen eller i Telemarksfjella",
        "terrain": "Skien er porten til Telemarkskanalen, og båtutleie her henger tett sammen med kanaltrafikken om sommeren.",
    },
    "alesund": {
        "trips": [("Geirangerfjorden", "ca. 2,5 t", "UNESCO-listet fjord med fossefall"),
                   ("Sunnmørsalpene", "rett utenfor byen", "tinder rett opp fra havet"),
                   ("Runde", "ca. 1 t", "en av Europas sørligste fuglefjell")],
        "waters": [("Aspøyfjorden og skjærgården", "øyer og sund rett utenfor jugendbyen"),
                    ("Geirangerfjorden", "for lengre turer sørøstover")],
        "summer": "båttur i skjærgården eller fjordcruise mot Geiranger",
        "winter": "toppturski i Sunnmørsalpene rett fra byen",
        "terrain": "Ålesund er omkranset av bratte alpetopper og åpent hav, noe som gjør både fritidsutstyr til fjell og båtutstyr til sjø svært etterspurt.",
    },
    "haugesund": {
        "trips": [("Røvær og Utsira", "ferge/båt", "øyer ute i havgapet"),
                   ("Skudeneshavn", "ca. 30 min", "godt bevart trehusby"),
                   ("Sveio og Haugalandet", "20–40 min", "kyststier og badeplasser")],
        "waters": [("Karmsundet", "smalt, historisk sund rett gjennom byen"),
                    ("Havgapet ved Røvær/Utsira", "åpent hav for de som vil lenger ut")],
        "summer": "øyhopping til Røvær og Utsira",
        "winter": "kystturer i le av Karmøy når vinden tillater det",
        "terrain": "Haugesund er en av landets vindfulle kystbyer, og båter og fritidsutstyr tilpasset værharde forhold er ekstra ettertraktet.",
    },
}

CITY_NAME = {
    "oslo": "Oslo", "bergen": "Bergen", "trondheim": "Trondheim", "stavanger": "Stavanger",
    "kristiansand": "Kristiansand", "jessheim": "Jessheim", "gardermoen": "Gardermoen",
    "drammen": "Drammen", "fredrikstad": "Fredrikstad", "sandnes": "Sandnes",
    "tromso": "Tromsø", "sarpsborg": "Sarpsborg", "skien": "Skien",
    "alesund": "Ålesund", "haugesund": "Haugesund",
}

MARKER_START = "<!-- LOCAL-CONTENT-START -->"
MARKER_END = "<!-- LOCAL-CONTENT-END -->"


def trips_section(cat_slug, city_slug):
    f = CITY_FACTS[city_slug]
    city = CITY_NAME[city_slug]
    items = "\n      ".join(
        f"<li><strong>{name}</strong> — {time_}. {desc}</li>" for name, time_, desc in f["trips"]
    )
    return f"""{MARKER_START}
  <section>
    <h2>Populære turmål fra {city}</h2>
    <ul>
      {items}
    </ul>
  </section>
{MARKER_END}"""


def waters_section(city_slug):
    f = CITY_FACTS[city_slug]
    city = CITY_NAME[city_slug]
    items = "\n      ".join(
        f"<li><strong>{name}</strong> — {desc}</li>" for name, desc in f["waters"]
    )
    return f"""{MARKER_START}
  <section>
    <h2>Populære farvann rundt {city}</h2>
    <ul>
      {items}
    </ul>
  </section>
{MARKER_END}"""


def leisure_section(city_slug):
    f = CITY_FACTS[city_slug]
    city = CITY_NAME[city_slug]
    return f"""{MARKER_START}
  <section>
    <h2>Populært i {city}</h2>
    <p>Om sommeren er {f["summer"]} et populært valg. Om vinteren er {f["winter"]} et alternativ mange i {city} benytter seg av.</p>
  </section>
{MARKER_END}"""


def terrain_section(city_slug):
    f = CITY_FACTS[city_slug]
    city = CITY_NAME[city_slug]
    return f"""{MARKER_START}
  <section>
    <h2>{city} og bruksområdet</h2>
    <p>{f["terrain"]}</p>
  </section>
{MARKER_END}"""


def section_for(cat_slug, city_slug):
    if cat_slug in ("taktelt", "bil"):
        return trips_section(cat_slug, city_slug)
    if cat_slug == "bat":
        return waters_section(city_slug)
    if cat_slug == "fritidsutstyr":
        return leisure_section(city_slug)
    if cat_slug in ("tilhenger", "maskiner", "verktoy"):
        return terrain_section(city_slug)
    return None


def process_file(path, cat_slug, city_slug):
    html = open(path, encoding="utf-8").read()
    section = section_for(cat_slug, city_slug)
    if section is None:
        return False

    if MARKER_START in html:
        html = re.sub(
            re.escape(MARKER_START) + r".*?" + re.escape(MARKER_END),
            section,
            html,
            flags=re.S,
        )
    else:
        # Insert right before the cta-box div (after the "items" section).
        idx = html.find('<div class="cta-box">')
        if idx == -1:
            print("no cta-box marker in", path)
            return False
        html = html[:idx] + section + "\n  " + html[idx:]

    open(path, "w", encoding="utf-8").write(html)
    return True


if __name__ == "__main__":
    updated = 0
    for path in glob.glob(f"{PUBLIC}/leie-*/index.html"):
        dirname = os.path.basename(os.path.dirname(path))
        m = re.match(r"leie-(.+)-([a-z]+)$", dirname)
        if not m:
            continue
        cat_slug, city_slug = m.group(1), m.group(2)
        if cat_slug not in ("taktelt", "tilhenger", "maskiner", "bil", "bat", "verktoy", "fritidsutstyr"):
            continue
        if city_slug not in CITY_FACTS:
            continue
        if process_file(path, cat_slug, city_slug):
            updated += 1
    print(f"Updated {updated} pages with local content")
