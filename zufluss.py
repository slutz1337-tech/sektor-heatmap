"""Sektor-Heatmap – Geldzufluss je Sektor und Branche sichtbar machen, Aktien vor dem Ausbruch.

Große Anleger lassen sich nicht nachweisen, aber ihre Spuren in Kursen und Volumen sichtbar machen.
Regeln wie im Rückblick-Test vom 03.11.2026 (rueckblick_vor_ausbruch.py); die Aktienliste in der
gelockerten Form (Ruhe und trockenes Volumen nur als Zusatz).

Gruppe (Branche nach Yahoo oder einer der elf Sektoren, mindestens 5 Aktien, gleich gewichtet):
  Mehrrendite gegenüber dem Gesamtmarkt über 3, 6 und 12 Monate, Richtung der relativen Stärke über
  30 Handelstage, Breite (Anteil der Aktien über ihrem 50-Tage-Durchschnitt), Volumen (Median der
  Mitglieder: Volumen an Plustagen ÷ Minustagen über 50 Tage).
    Zufluss stark: alle drei Zeiträume über dem Markt, Richtung steigt, Breite ≥ 60 %, Volumen ≥ 1,1
    Zufluss:       mindestens zwei der drei Zeiträume über dem Markt, Richtung steigt
    Abfluss:       mindestens zwei der drei Zeiträume unter dem Markt, Richtung fällt
Aktie vor dem Ausbruch (nur in Branchen mit Zufluss):
  1 Aufwärtsphase: über dem 50- und dem 150-Tage-Durchschnitt, der 150-Tage-Durchschnitt steigt
  2 Basis: Hoch der letzten 6 Monate liegt mindestens 5 Wochen zurück, höchstens 30 % tief,
    Kurs jetzt 0 bis 8 % unter dem Hoch (die Marke)
  3 Relative Stärke führt: Linie Aktie ÷ Markt höchstens 3 % unter ihrem Jahreshoch
  Zusatzmarken: Ruhe (Spanne der letzten 10 Tage höchstens halb so groß wie die Tiefe der Basis),
  Volumen trocknet aus (letzte 10 Tage unter 80 % der 50 Tage davor, in der Basis mehr Volumen an
  Plustagen als an Minustagen).
"""
import concurrent.futures
import json
import logging
import time

import numpy as np
import pandas as pd

from kurse import ABLAGE

BRANCHEN = ABLAGE / "branchen.json"
MINDEST_MITGLIEDER = 5
ZEITRAEUME = (("quartal", 63), ("halbjahr", 126), ("jahr", 252))
RICHTUNG_TAGE = 30
BREITE_STARK = 60.0
VOLUMEN_STARK = 1.1
BASIS_FENSTER = 125
BASIS_MINDEST_TAGE = 25
BASIS_TIEFE = 30.0
UNTER_HOCH = 8.0
RS_NAEHE = 3.0
RUHE_TAGE = 10
RUHE_ANTEIL = 0.5
VOLUMEN_TROCKEN = 0.8
ANZAHL_AKTIEN = 10

REGELN = {"mindest_mitglieder": MINDEST_MITGLIEDER, "richtung_tage": RICHTUNG_TAGE,
          "breite_stark": BREITE_STARK, "volumen_stark": VOLUMEN_STARK, "basis_wochen": BASIS_MINDEST_TAGE // 5,
          "basis_tiefe": BASIS_TIEFE, "unter_hoch": UNTER_HOCH, "rs_naehe": RS_NAEHE,
          "volumen_trocken": round(VOLUMEN_TROCKEN * 100), "anzahl_aktien": ANZAHL_AKTIEN}

EINSTUFUNG_RANG = {"stark": 0, "zufluss": 1, "neutral": 2, "abfluss": 3}

# Branchen nach Yahoo, auf Deutsch und ohne Abkürzungen
DEUTSCH = {
    "Advertising Agencies": "Werbeagenturen", "Aerospace & Defense": "Luftfahrt und Rüstung",
    "Agricultural Inputs": "Agrarchemie und Dünger", "Airlines": "Fluggesellschaften",
    "Airports & Air Services": "Flughäfen und Flugdienste", "Aluminum": "Aluminium",
    "Apparel Manufacturing": "Bekleidungshersteller", "Apparel Retail": "Bekleidungshandel",
    "Asset Management": "Vermögensverwaltung", "Auto & Truck Dealerships": "Autohandel",
    "Auto Manufacturers": "Autohersteller", "Auto Parts": "Autozulieferer",
    "Banks - Diversified": "Großbanken", "Banks - Regional": "Regionalbanken",
    "Beverages - Brewers": "Brauereien", "Beverages - Non-Alcoholic": "Alkoholfreie Getränke",
    "Beverages - Wineries & Distilleries": "Wein und Spirituosen", "Biotechnology": "Biotechnologie",
    "Broadcasting": "Rundfunk", "Building Materials": "Baustoffe",
    "Building Products & Equipment": "Bauprodukte und Gebäudetechnik",
    "Business Equipment & Supplies": "Bürobedarf und Geschäftsausstattung", "Capital Markets": "Investmentbanken und Broker",
    "Chemicals": "Chemie", "Communication Equipment": "Kommunikationstechnik",
    "Computer Hardware": "Computer und Speicher", "Confectioners": "Süßwaren", "Conglomerates": "Mischkonzerne",
    "Consulting Services": "Beratung", "Consumer Electronics": "Unterhaltungselektronik", "Copper": "Kupfer",
    "Credit Services": "Kreditkarten und Kredite", "Department Stores": "Kaufhäuser",
    "Diagnostics & Research": "Diagnostik und Forschung", "Discount Stores": "Discounter",
    "Drug Manufacturers - General": "Pharmakonzerne", "Drug Manufacturers - Specialty & Generic": "Spezial- und Generikapharma",
    "Education & Training Services": "Bildung und Schulung", "Electrical Equipment & Parts": "Elektrische Ausrüstung",
    "Electronic Components": "Elektronische Bauteile", "Electronic Gaming & Multimedia": "Computerspiele und Multimedia",
    "Electronics & Computer Distribution": "Elektronikgroßhandel", "Engineering & Construction": "Bau und Anlagenbau",
    "Entertainment": "Unterhaltung", "Farm & Heavy Construction Machinery": "Land- und Baumaschinen",
    "Farm Products": "Agrarprodukte", "Financial Conglomerates": "Finanzkonglomerate",
    "Financial Data & Stock Exchanges": "Börsen und Finanzdaten", "Food Distribution": "Lebensmittelgroßhandel",
    "Footwear & Accessories": "Schuhe und Accessoires", "Furnishings, Fixtures & Appliances": "Möbel und Hausgeräte",
    "Gambling": "Glücksspiel", "Gold": "Gold", "Grocery Stores": "Lebensmittelhandel",
    "Health Information Services": "Gesundheitsdaten und Software", "Healthcare Plans": "Krankenversicherer",
    "Home Improvement Retail": "Baumärkte", "Household & Personal Products": "Haushalt und Körperpflege",
    "Industrial Distribution": "Industriegroßhandel", "Information Technology Services": "Informationstechnik-Dienstleister",
    "Insurance - Diversified": "Versicherungskonzerne", "Insurance - Life": "Lebensversicherer",
    "Insurance - Property & Casualty": "Sachversicherer", "Insurance - Reinsurance": "Rückversicherer",
    "Insurance - Specialty": "Spezialversicherer", "Insurance Brokers": "Versicherungsmakler",
    "Integrated Freight & Logistics": "Fracht und Logistik", "Internet Content & Information": "Internetplattformen",
    "Internet Retail": "Onlinehandel", "Leisure": "Freizeit", "Lodging": "Hotels",
    "Lumber & Wood Production": "Holz", "Luxury Goods": "Luxusgüter", "Marine Shipping": "Seeschifffahrt",
    "Medical Care Facilities": "Kliniken und Pflege", "Medical Devices": "Medizingeräte",
    "Medical Distribution": "Medizingroßhandel", "Medical Instruments & Supplies": "Medizinbedarf",
    "Metal Fabrication": "Metallverarbeitung", "Oil & Gas Drilling": "Öl- und Gasbohrung",
    "Oil & Gas E&P": "Öl- und Gasförderung", "Oil & Gas Equipment & Services": "Öl- und Gasdienstleister",
    "Oil & Gas Integrated": "Integrierte Ölkonzerne", "Oil & Gas Midstream": "Öl- und Gastransport",
    "Oil & Gas Refining & Marketing": "Raffinerien", "Other Industrial Metals & Mining": "Industriemetalle und Bergbau",
    "Other Precious Metals & Mining": "Edelmetalle", "Packaged Foods": "Nahrungsmittel",
    "Packaging & Containers": "Verpackungen", "Paper & Paper Products": "Papier",
    "Personal Services": "Persönliche Dienstleistungen", "Pharmaceutical Retailers": "Apotheken und Drogerien",
    "Pollution & Treatment Controls": "Umwelttechnik", "Publishing": "Verlage",
    "REIT - Diversified": "Immobilienfonds gemischt", "REIT - Healthcare Facilities": "Immobilienfonds Gesundheit",
    "REIT - Hotel & Motel": "Immobilienfonds Hotels", "REIT - Industrial": "Immobilienfonds Logistik und Gewerbe",
    "REIT - Mortgage": "Immobilienfonds Hypotheken", "REIT - Office": "Immobilienfonds Büro",
    "REIT - Residential": "Immobilienfonds Wohnen", "REIT - Retail": "Immobilienfonds Handel",
    "REIT - Specialty": "Immobilienfonds Spezial", "Railroads": "Eisenbahnen",
    "Real Estate - Diversified": "Immobilien gemischt", "Real Estate Services": "Immobiliendienstleister",
    "Recreational Vehicles": "Freizeitfahrzeuge", "Rental & Leasing Services": "Vermietung und Leasing",
    "Residential Construction": "Hausbau", "Resorts & Casinos": "Ferienanlagen und Kasinos",
    "Restaurants": "Restaurants", "Scientific & Technical Instruments": "Mess- und Prüftechnik",
    "Security & Protection Services": "Sicherheitsdienste", "Semiconductor Equipment & Materials": "Halbleiterausrüstung",
    "Semiconductors": "Halbleiter", "Shell Companies": "Mantelgesellschaften",
    "Software - Application": "Anwendungssoftware", "Software - Infrastructure": "Infrastruktursoftware",
    "Solar": "Solar", "Specialty Business Services": "Unternehmensdienstleister", "Specialty Chemicals": "Spezialchemie",
    "Specialty Industrial Machinery": "Maschinenbau", "Specialty Retail": "Fachhandel",
    "Staffing & Employment Services": "Personaldienstleister", "Steel": "Stahl", "Telecom Services": "Telekommunikation",
    "Tobacco": "Tabak", "Tools & Accessories": "Werkzeuge", "Travel Services": "Reisedienstleister",
    "Trucking": "Lastwagentransport", "Utilities - Diversified": "Versorger gemischt",
    "Utilities - Independent Power Producers": "Unabhängige Stromerzeuger",
    "Utilities - Regulated Electric": "Stromversorger", "Utilities - Regulated Gas": "Gasversorger",
    "Utilities - Regulated Water": "Wasserversorger", "Utilities - Renewable": "Erneuerbare Energien",
    "Waste Management": "Entsorgung",
}


def branchen(ticker: list[str]) -> dict[str, str | None]:
    """Branche je Aktie nach Yahoo, in der Ablage gemerkt; nur neue Aktien werden abgefragt."""
    bekannt = json.loads(BRANCHEN.read_text(encoding="utf-8")) if BRANCHEN.exists() else {}
    fehlend = [t for t in ticker if t not in bekannt]
    if fehlend:
        import yfinance as yf
        logging.getLogger("yfinance").setLevel(logging.CRITICAL)

        def frage(t):
            for _ in range(3):
                try:
                    return t, yf.Ticker(t).get_info().get("industry")
                except Exception:
                    time.sleep(2)
            return t, None

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            neu = dict(pool.map(frage, fehlend))
        # Ohne Antwort nicht merken, damit der nächste Lauf es noch einmal versucht
        bekannt.update({t: b for t, b in neu.items() if b})
        ABLAGE.mkdir(parents=True, exist_ok=True)
        BRANCHEN.write_text(json.dumps(bekannt, ensure_ascii=False, indent=1), encoding="utf-8")
    return bekannt


def _aktie(tafel: pd.DataFrame, markt: pd.Series) -> dict | None:
    """Kennzahlen einer Aktie am letzten Tag; die Basis nur, wenn sie in der Aufwärtsphase ist."""
    c = tafel["Close"]
    if len(c) < BASIS_FENSTER + 60:
        return None
    v = tafel["Volume"].fillna(0)
    d50, d150 = c.rolling(50).mean(), c.rolling(150).mean()
    rs = c / markt.reindex(c.index, method="ffill")
    diff = c.diff()
    auf = v.where(diff > 0, 0).iloc[-50:].sum()
    ab = v.where(diff < 0, 0).iloc[-50:].sum()
    e = {"ueber_50": bool(c.iat[-1] > d50.iat[-1]), "auf_ab": float(auf / ab) if ab > 0 else None}
    aufwaerts = (c.iat[-1] > d50.iat[-1] and c.iat[-1] > d150.iat[-1]
                 and pd.notna(d150.iat[-21]) and d150.iat[-1] > d150.iat[-21])
    if not aufwaerts:
        return e
    werte, h, l = c.values, tafel["High"].fillna(c).values, tafel["Low"].fillna(c).values
    fenster = werte[-BASIS_FENSTER:]
    hoch = int(fenster.argmax())
    seit = len(fenster) - 1 - hoch
    marke = float(fenster[hoch])
    tiefe = (1 - fenster[hoch:].min() / marke) * 100
    abstand = (1 - werte[-1] / marke) * 100
    rs_hoch = rs.iloc[-252:].max()
    rs_abstand = (1 - rs.iat[-1] / rs_hoch) * 100
    if seit < BASIS_MINDEST_TAGE or tiefe > BASIS_TIEFE or not 0 < abstand <= UNTER_HOCH or rs_abstand > RS_NAEHE:
        return e
    spanne = (h[-RUHE_TAGE:].max() / l[-RUHE_TAGE:].min() - 1) * 100
    vol = v.values
    vorher = vol[-RUHE_TAGE - 50:-RUHE_TAGE].mean()
    vol_anteil = vol[-RUHE_TAGE:].mean() / vorher * 100 if vorher > 0 else None
    basis_c, basis_v = werte[-min(seit + 1, 51):], vol[-min(seit + 1, 51):]
    d = np.diff(basis_c)
    b_auf, b_ab = basis_v[1:][d > 0].sum(), basis_v[1:][d < 0].sum()
    e["vor_ausbruch"] = {
        "marke": float(f"{marke:.5g}"), "seit": c.index[-1 - seit].date().isoformat(),
        "wochen": round((seit + 1) / 5), "tiefe": round(float(tiefe), 1), "abstand": round(float(abstand), 1),
        "rs_abstand": round(float(rs_abstand), 1), "spanne": round(float(spanne), 1),
        "volumen_anteil": None if vol_anteil is None else round(float(vol_anteil)),
        "ruhe": bool(spanne <= RUHE_ANTEIL * tiefe),
        "trocken": bool(vol_anteil is not None and vol_anteil < VOLUMEN_TROCKEN * 100 and b_ab > 0 and b_auf > b_ab),
    }
    return e


def _gruppe(name, art, mitglieder, tafeln, kennz, kalender, markt):
    renditen = pd.DataFrame({t: tafeln[t]["Close"].reindex(kalender).ffill(limit=5).pct_change(fill_method=None)
                             for t in mitglieder})
    index = (1 + renditen.mean(axis=1).fillna(0)).cumprod()
    rs = (index / markt).values
    if len(rs) <= max(z for _, z in ZEITRAEUME):
        return None
    mehr = {k: round(float((rs[-1] / rs[-1 - z] - 1) * 100), 2) for k, z in ZEITRAEUME}
    richtung = round(float((rs[-1] / rs[-1 - RICHTUNG_TAGE] - 1) * 100), 2)
    breite = round(100 * float(np.mean([kennz[t]["ueber_50"] for t in mitglieder])), 0)
    verhaeltnis = [kennz[t]["auf_ab"] for t in mitglieder if kennz[t]["auf_ab"] is not None]
    volumen = round(float(np.median(verhaeltnis)), 2) if verhaeltnis else None
    besser = sum(1 for w in mehr.values() if w > 0)
    if besser == 3 and richtung > 0 and breite >= BREITE_STARK and (volumen or 0) >= VOLUMEN_STARK:
        einstufung = "stark"
    elif besser >= 2 and richtung > 0:
        einstufung = "zufluss"
    elif besser <= 1 and richtung < 0:
        einstufung = "abfluss"
    else:
        einstufung = "neutral"
    return {"name": DEUTSCH.get(name, name), "art": art, "anzahl": len(mitglieder), "mehr": mehr,
            "richtung": richtung, "breite": breite, "volumen": volumen, "einstufung": einstufung}


def auswerten(tafeln: dict, liste: dict, stand: dict) -> dict:
    """Gruppen mit ihrer Einstufung und die Aktien vor dem Ausbruch je Region."""
    alle = [m["ticker"] for r in ("usa", "europa") for m in liste.get(r, [])]
    zuordnung = branchen(alle)
    ergebnis = {"regeln": REGELN}
    for region in stand["regionen"]:
        schluessel = region["schluessel"]
        markt_tafel = tafeln.get(region["gesamtmarkt"]["ticker"])
        gezaehlt = {a["ticker"]: a for a in (stand.get("aktien") or {}).get(schluessel, {}).get("aktien", [])}
        if markt_tafel is None or not gezaehlt:
            continue
        ticker = [t for t in gezaehlt if t in tafeln]
        kennz = {t: _aktie(tafeln[t], markt_tafel["Close"]) for t in ticker}
        ticker = [t for t in ticker if kennz[t] is not None]
        kalender = pd.DatetimeIndex(sorted(set().union(*[tafeln[t].index for t in ticker])))
        markt = markt_tafel["Close"].reindex(kalender).ffill()

        gruppen, branche_von = [], {}
        for art, schluessel_von in (("Sektor", lambda t: gezaehlt[t]["sektor"]), ("Branche", lambda t: zuordnung.get(t))):
            mitglieder = {}
            for t in ticker:
                if schluessel_von(t):
                    mitglieder.setdefault(schluessel_von(t), []).append(t)
            for name, liste_g in mitglieder.items():
                if len(liste_g) < MINDEST_MITGLIEDER:
                    continue
                g = _gruppe(name, art, liste_g, tafeln, kennz, kalender, markt)
                if g:
                    gruppen.append(g)
                    if art == "Branche":
                        for t in liste_g:
                            branche_von[t] = g
        gruppen.sort(key=lambda g: (EINSTUFUNG_RANG[g["einstufung"]], -sum(g["mehr"].values())))

        kandidaten = []
        for t in ticker:
            g = branche_von.get(t)
            va = kennz[t].get("vor_ausbruch")
            if not g or not va or g["einstufung"] not in ("stark", "zufluss"):
                continue
            a = gezaehlt[t]
            kandidaten.append({"ticker": t, "name": a["name"], "sektor": a["sektor"], "index": a["index"],
                               "indizes": a.get("indizes", [a["index"]]), "branche": g["name"],
                               "gruppe": g["einstufung"], "vor_ausbruch": va,
                               "kurs": a.get("kurs"), "kurs_datum": a.get("kurs_datum")})
        # Reihenfolge: starker Zufluss vor Zufluss, dann mehr Zusatzmarken, dann am nächsten an der Marke
        kandidaten.sort(key=lambda a: (a["gruppe"] != "stark",
                                       -(a["vor_ausbruch"]["ruhe"] + a["vor_ausbruch"]["trocken"]),
                                       a["vor_ausbruch"]["abstand"]))
        ergebnis[schluessel] = {
            "gruppen": gruppen,
            "aktien": kandidaten[:ANZAHL_AKTIEN],
            "kandidaten": len(kandidaten),
            "geprueft": len(ticker),
            "ohne_branche": sum(1 for t in ticker if not zuordnung.get(t)),
        }
    return ergebnis
