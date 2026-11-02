"""Sektor-Heatmap – Kurse holen und die Entwicklung je Sektor und Zeitraum berechnen.

Für jeden Sektor stehen in fonds.json mehrere Indexfonds verschiedener Anbieter.
Jeder Fonds wird einzeln ausgewertet; der Wert des Sektors ist der Median der
Fonds, die aktuelle Kurse haben. So verfälscht ein einzelner Fonds mit Lücke
oder Ausreißer das Bild nicht.

Kurse von Yahoo über yfinance, bereinigt um Ausschüttungen und Splits
(auto_adjust), also die Entwicklung inklusive Ausschüttungen. Kein Schlüssel nötig.

Aufruf von Hand:  py kurse.py   (holt neu und schreibt den Stand)
"""
import datetime as dt
import json
import logging
import os
import pathlib
import statistics
import threading

import pandas as pd

HIER = pathlib.Path(__file__).resolve().parent
FONDS = HIER / "fonds.json"
# Ablage für Stand und Mitgliederlisten; in der Cloud über SEKTOR_ABLAGE vorgegeben
ABLAGE = pathlib.Path(os.environ.get("SEKTOR_ABLAGE") or HIER.parent.parent / "DeepWork_V1" / "Sektor-Heatmap")
STAND = ABLAGE / "stand.json"

ZEITRAEUME = [
    ("tag", "1 Tag"),
    ("woche", "1 Woche"),
    ("monat", "1 Monat"),
    ("quartal", "3 Monate"),
    ("halbjahr", "6 Monate"),
    ("jahr", "1 Jahr"),
    ("jahresbeginn", "Seit Jahresbeginn"),
]
# Gruppen je Region in fonds.json: die elf Sektoren und die feineren Branchen und Themen
GRUPPEN = ("sektoren", "themen")
# Liegt der letzte Kurs eines Fonds mehr Kalendertage hinter dem jüngsten Kurs
# seiner Region, zählt er nicht mit (Handel ausgesetzt, Daten hängen).
VERALTET_TAGE = 4
# Der Vergleichskurs darf höchstens so viele Tage vor dem Stichtag liegen.
LUECKE_TAGE = 7
# Ausreißer: liegt ein Fonds von jedem anderen Fonds seines Sektors mehr als
# 10 Prozentpunkte und mehr als die Hälfte des Medians der übrigen entfernt, zählt er
# für diesen Zeitraum nicht – höchstens ein Fonds je Sektor und Zeitraum, nur ab drei
# Fonds. Gemessen wird zum nächsten Nachbarn, damit zwei Fondspaare auf verschieden
# geschnittene Indizes (MSCI und STOXX) sich nicht gegenseitig hinauswerfen.
AUSREISSER_PUNKTE = 10.0
AUSREISSER_ANTEIL = 0.5
# Uneinig: liegen die gezählten Fonds um mehr als 3 Prozentpunkte und mehr als ein
# Viertel des Werts auseinander, markiert die Oberfläche die Zelle.
UNEINIG_PUNKTE = 3.0
UNEINIG_ANTEIL = 0.25

_sperre = threading.Lock()

# Fortschritt des laufenden Aktualisierens, abgefragt über /api/fortschritt
PAKET = 150  # Kürzel je Abruf bei Yahoo; kleinere Pakete melden öfter Fortschritt
FORTSCHRITT = {"aktiv": False, "anteil": 0.0, "schritt": "", "beginn": None}


def melden(anteil: float, schritt: str):
    FORTSCHRITT.update(anteil=round(min(max(anteil, 0.0), 1.0), 3), schritt=schritt)


def stichtag(letzter: pd.Timestamp, schluessel: str) -> pd.Timestamp:
    if schluessel == "woche":
        return letzter - pd.Timedelta(days=7)
    if schluessel == "monat":
        return letzter - pd.DateOffset(months=1)
    if schluessel == "quartal":
        return letzter - pd.DateOffset(months=3)
    if schluessel == "halbjahr":
        return letzter - pd.DateOffset(months=6)
    if schluessel == "jahresbeginn":
        return pd.Timestamp(letzter.year - 1, 12, 31)
    if schluessel == "jahr":
        return letzter - pd.DateOffset(years=1)
    raise ValueError(schluessel)


def entwicklung(reihe: pd.Series, schluessel: str) -> float | None:
    """Entwicklung in Prozent vom Schlusskurs am Stichtag bis zum letzten Schlusskurs."""
    if len(reihe) < 2:
        return None
    ende = float(reihe.iloc[-1])
    if schluessel == "tag":
        anfang = float(reihe.iloc[-2])
    else:
        tag = stichtag(reihe.index[-1], schluessel)
        vorher = reihe[reihe.index <= tag]
        if vorher.empty or (tag - vorher.index[-1]).days > LUECKE_TAGE:
            return None
        anfang = float(vorher.iloc[-1])
    if anfang <= 0:
        return None
    return round((ende / anfang - 1) * 100, 2)


def _herunterladen(ticker: list[str], nachholen: set[str] | None = None,
                   von: float = 0.0, bis: float = 1.0) -> dict[str, pd.Series]:
    """Kursreihen je Kürzel, in Paketen zu PAKET Kürzeln; der Fortschritt läuft dabei von „von“
    bis „bis“. Fehlende Kürzel aus „nachholen“ werden einzeln ein zweites Mal abgefragt (für die
    Fonds; bei rund 1.400 Aktien wäre das zu langsam)."""
    import yfinance as yf
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)

    beginn = (dt.date.today() - dt.timedelta(days=400)).isoformat()

    def holen(liste):
        roh = yf.download(liste, start=beginn, interval="1d", auto_adjust=True,
                          progress=False, group_by="ticker", threads=True)
        ergebnis = {}
        for t in liste:
            try:
                reihe = roh[t]["Close"]
            except (KeyError, TypeError):
                try:
                    reihe = roh["Close"]  # Einzelabruf ohne Tickerebene
                except (KeyError, TypeError):
                    continue
            if isinstance(reihe, pd.DataFrame):
                reihe = reihe.iloc[:, 0]
            reihe = reihe.dropna()
            reihe = reihe[reihe > 0]
            if len(reihe):
                reihe.index = pd.to_datetime(reihe.index).tz_localize(None).normalize()
                ergebnis[t] = reihe.astype(float)
        return ergebnis

    reihen = {}
    for start in range(0, len(ticker), PAKET):
        melden(von + (bis - von) * start / len(ticker),
               f"Kurse laden: {start:,} von {len(ticker):,} Werten".replace(",", "."))
        reihen.update(holen(ticker[start:start + PAKET]))
    fehlend = [t for t in ticker if t not in reihen and (nachholen is None or t in nachholen)]
    if fehlend:  # zweiter Versuch einzeln – Yahoo lässt bei Sammelabrufen gelegentlich Werte fallen
        melden(bis, f"{len(fehlend)} fehlende Fonds einzeln nachfragen")
        for t in fehlend:
            reihen.update(holen([t]))
    return reihen


def berechnen(reihen: dict[str, pd.Series], plan: dict) -> dict:
    regionen = []
    for region in plan["regionen"]:
        alle = [f["ticker"] for g in GRUPPEN for s in region.get(g, []) for f in s["fonds"]]
        alle.append(region["gesamtmarkt"]["ticker"])
        letzte = [reihen[t].index[-1] for t in alle if t in reihen]
        juengster = max(letzte) if letzte else None

        def fonds_auswerten(fonds):
            t = fonds["ticker"]
            eintrag = {"ticker": t, "name": fonds["name"], "letzter_kurs": None,
                       "werte": {}, "ausgeschlossen": None}
            reihe = reihen.get(t)
            if reihe is None:
                eintrag["ausgeschlossen"] = "keine Kurse geliefert"
                return eintrag
            eintrag["letzter_kurs"] = reihe.index[-1].date().isoformat()
            if (juengster - reihe.index[-1]).days > VERALTET_TAGE:
                eintrag["ausgeschlossen"] = "letzter Kurs veraltet"
            eintrag["werte"] = {k: entwicklung(reihe, k) for k, _ in ZEITRAEUME}
            return eintrag

        def gruppe_auswerten(liste):
            sektoren = []
            for sektor in liste:
                fonds = [fonds_auswerten(f) for f in sektor["fonds"]]
                werte, spannen, anzahl, uneinig = {}, {}, {}, {}
                for f in fonds:
                    f["ausreisser"] = []
                for k, _ in ZEITRAEUME:
                    gueltig = [f for f in fonds
                               if not f["ausgeschlossen"] and f["werte"].get(k) is not None]
                    # Ab drei Fonds: den Fonds, der von allen übrigen weit abliegt, als
                    # Ausreißer werten (meist ein Datenfehler bei Yahoo) und nicht mitzählen.
                    if len(gueltig) >= 3:
                        def naechster(f):
                            return min(abs(f["werte"][k] - g["werte"][k]) for g in gueltig if g is not f)
                        weitester = max(gueltig, key=naechster)
                        andere = statistics.median(g["werte"][k] for g in gueltig if g is not weitester)
                        if naechster(weitester) > max(AUSREISSER_PUNKTE, AUSREISSER_ANTEIL * abs(andere)):
                            weitester["ausreisser"].append(k)
                            gueltig = [f for f in gueltig if f is not weitester]
                    zahlen = [f["werte"][k] for f in gueltig]
                    werte[k] = round(statistics.median(zahlen), 2) if zahlen else None
                    spannen[k] = round(max(zahlen) - min(zahlen), 2) if len(zahlen) > 1 else None
                    anzahl[k] = len(zahlen)
                    uneinig[k] = bool(spannen[k] is not None and werte[k] is not None and
                                      spannen[k] > max(UNEINIG_PUNKTE, UNEINIG_ANTEIL * abs(werte[k])))
                sektoren.append({"name": sektor["name"], "werte": werte, "spanne": spannen,
                                 "anzahl": anzahl, "uneinig": uneinig, "fonds": fonds})
            return sektoren

        gesamt = fonds_auswerten(region["gesamtmarkt"])
        regionen.append({
            "schluessel": region["schluessel"], "name": region["name"],
            "waehrung": region["waehrung"], "boerse": region["boerse"],
            "stand": juengster.date().isoformat() if juengster is not None else None,
            "sektoren": gruppe_auswerten(region["sektoren"]),
            "themen": gruppe_auswerten(region.get("themen", [])),
            "gesamtmarkt": gesamt,
        })
    return {
        "abgerufen": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "zeitraeume": [{"schluessel": k, "name": n} for k, n in ZEITRAEUME],
        "regionen": regionen,
    }


def aktualisieren() -> dict:
    """Holt alle Kurse neu, berechnet die Heatmaps und legt den Stand ab."""
    with _sperre:
        FORTSCHRITT.update(aktiv=True, beginn=dt.datetime.now().isoformat(timespec="seconds"))
        try:
            return _aktualisieren()
        finally:
            FORTSCHRITT.update(aktiv=False, anteil=1.0, schritt="fertig")


def _aktualisieren() -> dict:
    melden(0.01, "Fondsliste und Mitgliederlisten der Indizes prüfen")
    plan = json.loads(FONDS.read_text(encoding="utf-8"))
    ticker = sorted({f["ticker"] for r in plan["regionen"] for g in GRUPPEN for s in r.get(g, []) for f in s["fonds"]}
                    | {r["gesamtmarkt"]["ticker"] for r in plan["regionen"]})
    import aktien  # hier, weil aktien.py seinerseits ABLAGE aus diesem Modul holt
    try:
        liste = aktien.mitglieder()
    except Exception:  # ohne Mitgliederlisten trotzdem die Heatmaps liefern
        liste = None
    aktien_ticker = {m["ticker"] for r in ("usa", "europa") for m in liste[r]} if liste else set()
    # Fonds zuerst, damit die Heatmaps auch bei einem Abbruch mitten in den Aktien stehen
    reihenfolge = sorted(ticker) + sorted(aktien_ticker - set(ticker))
    reihen = _herunterladen(reihenfolge, nachholen=set(ticker), von=0.04, bis=0.9)
    if not any(t in reihen for t in ticker):
        raise RuntimeError("Yahoo hat keine Kurse geliefert – Internetverbindung prüfen.")
    melden(0.92, "Entwicklung je Sektor, Thema und Aktie berechnen")
    stand = berechnen(reihen, plan)
    stand["aktien"] = aktien.auswerten(reihen, liste, stand) if liste else None
    melden(0.97, "Stand speichern")
    ABLAGE.mkdir(parents=True, exist_ok=True)
    zwischen = STAND.with_suffix(".tmp")
    zwischen.write_text(json.dumps(stand, ensure_ascii=False, indent=1), encoding="utf-8")
    zwischen.replace(STAND)
    return stand


def laden() -> dict | None:
    if not STAND.exists():
        return None
    return json.loads(STAND.read_text(encoding="utf-8"))


if __name__ == "__main__":
    s = aktualisieren()
    for r in s["regionen"]:
        print(f"{r['name']}: Stand {r['stand']}")
        for sektor in r["sektoren"] + r["themen"]:
            w = sektor["werte"]
            print(f"  {sektor['name'][:26]:26s} " + "  ".join(
                f"{(w[k] if w[k] is not None else float('nan')):+7.2f}" for k, _ in ZEITRAEUME))
    print("Abgelegt in", STAND)
