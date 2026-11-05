"""Sektor-Heatmap – Einzelaktien je Sektor.

Mitgliederlisten von Wikipedia, einmal im Monat neu geladen und dazwischen aus der
Ablage gelesen:
  USA     S&P 500 und S&P 400 mit Sektor nach GICS (passt eins zu eins auf die elf Sektoren)
  Europa  die großen Landesindizes (DAX, MDAX, CAC 40, FTSE 100, SMI, AEX, IBEX 35, FTSE MIB,
          OMX Stockholm 30, OBX, OMX Kopenhagen 25, OMX Helsinki 25, BEL 20, PSI); der Sektor
          kommt einheitlich von Yahoo, weil jede Indexseite anders gliedert.

Die Liste des STOXX Europe 600 bei Wikipedia taugt nicht: sie ist unvollständig und führt
Firmen, die längst nicht mehr notiert sind (geprüft am 13.10.2026).
"""
import concurrent.futures
import datetime as dt
import io
import json
import logging
import re

import pandas as pd

from kurse import ABLAGE

MITGLIEDER = ABLAGE / "mitglieder.json"
GUELTIG_TAGE = 30
FASSUNG = 2  # 2: je Aktie alle Indizes, in denen sie steht
KOPF = {"User-Agent": "Mozilla/5.0 (Sektor-Heatmap; private Nutzung)"}
WIKI = "https://en.wikipedia.org/wiki/"

QUELLEN_USA = [("S&P 500", "List_of_S%26P_500_companies"), ("S&P 400", "List_of_S%26P_400_companies")]

GICS = {
    "Information Technology": "Technologie", "Health Care": "Gesundheit", "Financials": "Finanzen",
    "Consumer Discretionary": "Zyklischer Konsum", "Consumer Staples": "Basiskonsum",
    "Energy": "Energie", "Industrials": "Industrie", "Materials": "Grundstoffe",
    "Utilities": "Versorger", "Real Estate": "Immobilien", "Communication Services": "Kommunikation",
}
YAHOO_SEKTOR = {
    "Technology": "Technologie", "Healthcare": "Gesundheit", "Financial Services": "Finanzen",
    "Consumer Cyclical": "Zyklischer Konsum", "Consumer Defensive": "Basiskonsum",
    "Energy": "Energie", "Industrials": "Industrie", "Basic Materials": "Grundstoffe",
    "Utilities": "Versorger", "Real Estate": "Immobilien", "Communication Services": "Kommunikation",
}
BOERSEN = {
    ".DE": "Xetra", ".PA": "Paris", ".L": "London", ".SW": "Zürich", ".AS": "Amsterdam",
    ".MC": "Madrid", ".MI": "Mailand", ".ST": "Stockholm", ".OL": "Oslo", ".CO": "Kopenhagen",
    ".HE": "Helsinki", ".BR": "Brüssel", ".LS": "Lissabon",
}
PLATZ = {"Euronext Brussels": ".BR", "Euronext Amsterdam": ".AS", "Euronext Paris": ".PA",
         "Euronext Lisbon": ".LS", "OSE": ".OL"}


def _mit_endung(endung):
    """Kürzel ohne Börsenendung: Leerzeichen und Punkte werden zu Bindestrichen (BT.A → BT-A)."""
    def umsetzen(k):
        k = k.strip().upper().replace(" ", "-").replace(".", "-").rstrip("-")
        return k + endung
    return umsetzen


def _wie_es_ist(k):
    return k.strip()


def _mit_platz(standard):
    """„Euronext Brussels: ABI“ oder „OSE: EQNR“ → Endung nach dem genannten Platz."""
    def umsetzen(k):
        if ":" in k:
            platz, k = (t.strip() for t in k.split(":", 1))
            return _mit_endung(PLATZ.get(platz, standard))(k)
        return _mit_endung(standard)(k)
    return umsetzen


# Index, Wikipedia-Seite, Spalte mit dem Kürzel, Umsetzung ins Yahoo-Kürzel
QUELLEN_EUROPA = [
    ("DAX", "DAX", "Ticker", _wie_es_ist),
    ("MDAX", "MDAX", "Symbol", _mit_endung(".DE")),
    ("CAC 40", "CAC_40", "Ticker", _wie_es_ist),
    ("FTSE 100", "FTSE_100_Index", "Ticker", _mit_endung(".L")),
    ("SMI", "Swiss_Market_Index", "Ticker", _mit_endung(".SW")),
    ("AEX", "AEX_index", "Ticker", _wie_es_ist),
    ("IBEX 35", "IBEX_35", "Ticker", _wie_es_ist),
    ("FTSE MIB", "FTSE_MIB", "Ticker", _wie_es_ist),
    ("OMX Stockholm 30", "OMX_Stockholm_30", "Ticker", _wie_es_ist),
    ("OBX", "OBX_Index", "Ticker symbol", _mit_platz(".OL")),
    ("OMX Kopenhagen 25", "OMX_Copenhagen_25", "Ticker symbol", _mit_endung(".CO")),
    ("OMX Helsinki 25", "OMX_Helsinki_25", "Ticker", _wie_es_ist),
    ("BEL 20", "BEL_20", "Ticker symbol", _mit_platz(".BR")),
    ("PSI", "PSI-20", "Ticker", _mit_endung(".LS")),
]


def _tabellen(seite: str) -> list[pd.DataFrame]:
    import requests
    antwort = requests.get(WIKI + seite, headers=KOPF, timeout=30)
    antwort.raise_for_status()
    return pd.read_html(io.StringIO(antwort.text))


def _spalte(tabelle: pd.DataFrame, namen: tuple[str, ...]):
    for c in tabelle.columns:
        if any(n.lower() in str(c).lower() for n in namen):
            return c
    return None


def _usa() -> list[dict]:
    usa, gesehen = [], set()
    for index, seite in QUELLEN_USA:
        tabelle = next(t for t in _tabellen(seite) if "GICS Sector" in t.columns)
        for _, z in tabelle.iterrows():
            sektor = GICS.get(str(z["GICS Sector"]).strip())
            yahoo = str(z["Symbol"]).strip().replace(".", "-")
            if not sektor or yahoo in gesehen:
                continue
            gesehen.add(yahoo)
            usa.append({"ticker": yahoo, "name": str(z["Security"]).strip(), "sektor": sektor,
                        "boerse": "New York", "index": index, "indizes": [index]})
    return usa


def _europa_roh() -> tuple[list[dict], list[str]]:
    roh, gesehen, firmen, fehler = [], {}, {}, []
    for index, seite, spaltenname, umsetzen in QUELLEN_EUROPA:
        try:
            tabelle = next(t for t in _tabellen(seite)
                           if len(t) >= 15 and _spalte(t, (spaltenname,)) is not None)
        except Exception as e:  # eine fehlende Seite soll die übrigen nicht aufhalten
            fehler.append(f"{index}: {e}")
            continue
        k_spalte = _spalte(tabelle, (spaltenname,))
        n_spalte = _spalte(tabelle, ("Company", "Name"))
        for _, z in tabelle.iterrows():
            if pd.isna(z[k_spalte]):
                continue
            yahoo = umsetzen(str(z[k_spalte]).replace("\xa0", " "))
            if not re.fullmatch(r"[A-Z0-9&-]+\.[A-Z]{1,2}", yahoo):
                continue
            name = str(z[n_spalte]).strip() if n_spalte is not None and not pd.isna(z[n_spalte]) else ""
            # Dieselbe Firma in zwei Indizes (Airbus in DAX und CAC 40, STMicroelectronics in
            # CAC 40 und FTSE MIB) nur einmal führen, aber jeden Index vermerken
            firma = re.sub(r"[^a-z0-9]", "", name.lower())[:12] or yahoo
            vorhanden = gesehen.get(yahoo) or firmen.get(firma)
            if vorhanden:
                if index not in vorhanden["indizes"]:
                    vorhanden["indizes"].append(index)
                continue
            eintrag = {"ticker": yahoo, "name": name, "index": index, "indizes": [index],
                       "boerse": BOERSEN.get("." + yahoo.rsplit(".", 1)[1], yahoo.rsplit(".", 1)[1])}
            gesehen[yahoo] = firmen[firma] = eintrag
            roh.append(eintrag)
    return roh, fehler


def _yahoo_sektoren(ticker: list[str]) -> dict[str, tuple[str | None, str]]:
    """Sektor und Name je Kürzel von Yahoo, parallel abgefragt."""
    import yfinance as yf
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)

    def frage(t):
        try:
            info = yf.Ticker(t).get_info()
            return t, (info.get("sector"), info.get("longName") or info.get("shortName") or "")
        except Exception:
            return t, (None, "")

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(frage, ticker))


def mitglieder_laden_neu(alt: dict | None) -> dict:
    usa = _usa()
    europa, fehler = _europa_roh()
    bekannt = {m["ticker"]: m for m in (alt or {}).get("europa", []) if m.get("sektor")}
    neu = [m["ticker"] for m in europa if m["ticker"] not in bekannt]
    antworten = _yahoo_sektoren(neu) if neu else {}
    fertig = []
    for m in europa:
        if m["ticker"] in bekannt:
            m["sektor"] = bekannt[m["ticker"]]["sektor"]
            m["name"] = m["name"] or bekannt[m["ticker"]]["name"]
        else:
            sektor, name = antworten.get(m["ticker"], (None, ""))
            m["sektor"] = YAHOO_SEKTOR.get(sektor or "")
            m["name"] = m["name"] or name
        if m["sektor"]:
            fertig.append(m)
    return {"fassung": FASSUNG, "abgerufen": dt.date.today().isoformat(), "usa": usa, "europa": fertig,
            "quellen": {"usa": [q[0] for q in QUELLEN_USA], "europa": [q[0] for q in QUELLEN_EUROPA]},
            "fehler": fehler}


def mitglieder() -> dict:
    """Mitgliederlisten aus der Ablage; älter als GUELTIG_TAGE oder fehlend → neu laden.
    Scheitert das Neuladen, bleibt die alte Ablage in Gebrauch."""
    alt = json.loads(MITGLIEDER.read_text(encoding="utf-8")) if MITGLIEDER.exists() else None
    if (alt and alt.get("fassung") == FASSUNG
            and (dt.date.today() - dt.date.fromisoformat(alt["abgerufen"])).days <= GUELTIG_TAGE):
        return alt
    try:
        neu = mitglieder_laden_neu(alt)
    except Exception:
        if alt:
            return alt
        raise
    ABLAGE.mkdir(parents=True, exist_ok=True)
    MITGLIEDER.write_text(json.dumps(neu, ensure_ascii=False, indent=1), encoding="utf-8")
    return neu


def kurssprung(reihe: pd.Series) -> bool:
    """Ein Tagessprung über +300 % oder unter −80 % ist bei Yahoo fast immer ein Datenfehler
    (nicht bereinigter Split, Wechsel zwischen Pence und Pfund)."""
    r = reihe.pct_change().dropna()
    return bool((r > 3).any() or (r < -0.8).any())


def trend(reihe: pd.Series) -> dict | None:
    """Kennzahlen für die Momentum-Rangliste, in Handelstagen gezählt (ein Jahr = 252, ein
    Monat = 21). Ohne ein volles Jahr Kurse gibt es keine Kennzahlen."""
    if len(reihe) < 253:
        return None
    kurs = reihe.iloc[-1]
    vor_monat = reihe.iloc[-22]
    hoch = reihe.iloc[-252:].max()
    tagesrenditen = reihe.iloc[-253:].pct_change().dropna()
    runden = lambda v: round(float(v), 2)
    return {
        "zwoelf_ohne_letzten": runden((vor_monat / reihe.iloc[-253] - 1) * 100),
        "sechs_ohne_letzten": runden((vor_monat / reihe.iloc[-127] - 1) * 100),
        "schwankung": runden(tagesrenditen.std() * 252 ** 0.5 * 100),
        "abstand_hoch": runden((kurs / hoch - 1) * 100),
        "ueber_200": bool(kurs > reihe.iloc[-200:].mean()),
        "durchschnitt_50_ueber_200": bool(reihe.iloc[-50:].mean() > reihe.iloc[-200:].mean()),
    }


def auswerten(tafeln: dict, liste: dict, stand: dict) -> dict:
    """Entwicklung, Trendkennzahlen und Muster jeder Aktie. Ohne aktuelle Kurse oder mit einem
    Kurssprung (Datenfehler) fällt eine Aktie heraus und wird mit Grund aufgeführt."""
    from kurse import VERALTET_TAGE, ZEITRAEUME, entwicklung
    import muster
    ergebnis = {}
    for region in stand["regionen"]:
        schluessel = region["schluessel"]
        juengster = pd.Timestamp(region["stand"]) if region["stand"] else None
        gezaehlt, heraus = [], []
        for m in liste.get(schluessel, []):
            tafel = tafeln.get(m["ticker"])
            reihe = tafel["Close"] if tafel is not None else None
            grund = None
            if reihe is None or len(reihe) < 2:
                grund = "keine Kurse geliefert"
            elif juengster is not None and (juengster - reihe.index[-1]).days > VERALTET_TAGE:
                grund = "letzter Kurs veraltet"
            elif kurssprung(reihe):
                grund = "Kurssprung, vermutlich Datenfehler"
            eintrag = {"ticker": m["ticker"], "name": m["name"], "sektor": m["sektor"],
                       "boerse": m["boerse"], "index": m["index"],
                       "indizes": m.get("indizes", [m["index"]])}
            if grund:
                heraus.append({**eintrag, "grund": grund})
                continue
            eintrag["werte"] = {k: entwicklung(reihe, k) for k, _ in ZEITRAEUME}
            eintrag["kurs"] = float(f"{reihe.iloc[-1]:.6g}")
            eintrag["kurs_datum"] = reihe.index[-1].date().isoformat()
            eintrag["trend"] = trend(reihe)
            eintrag["muster"] = muster.auswerten(tafel)
            gezaehlt.append(eintrag)
        ergebnis[schluessel] = {"aktien": gezaehlt, "heraus": heraus,
                                "quellen": liste.get("quellen", {}).get(schluessel, []),
                                "mitglieder_stand": liste.get("abgerufen")}
    return ergebnis
