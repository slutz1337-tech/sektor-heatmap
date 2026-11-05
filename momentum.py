"""Sektor-Heatmap – Momentum-Rangliste nach festen Regeln.

Bereiche (Sektoren, Branchen und Themen einer Region):
  Momentum-Wert = Mittel der Rangplätze über 1, 3, 6 und 12 Monate, ausgedrückt als „besser als
  so viel Prozent der Bereiche dieser Region“ (0 bis 100). Gezählt wird nur, wer alle vier hat.

Aktien – nur aus den drei stärksten Sektoren der Region (Aktien sind nach den elf Sektoren
eingeordnet, nicht nach Themen). Zugelassen ist eine Aktie nur, wenn alle Filter halten:
  - mindestens ein Jahr Kurse
  - Kurs über dem Durchschnitt der letzten 200 Handelstage (Aufwärtstrend)
  - Durchschnitt der letzten 50 über dem der letzten 200 Handelstage (Trend bestätigt)
  - höchstens 15 Prozent unter dem Hoch der letzten 52 Wochen
  - Phase 2 (Aufwärtsphase, siehe muster.py)
Momentum-Wert: Kursgewinn über 12 und über 6 Monate, jeweils ohne den letzten Monat (kurzfristige
Ausschläge drehen oft wieder), geteilt durch die Schwankung – ruhige Aufwärtstrends vor wilden
Sprüngen. Von beiden der Rangplatz unter den zugelassenen Aktien, daraus der Mittelwert.
Reihenfolge: zuerst Aktien, die alle Regeln erfüllen (frischer Ausbruch mit Volumen), dann die
zum Beobachten (an der Ausbruchsmarke), dann die übrigen – jeweils nach Momentum-Wert.

Grundlage ist allein der Kursverlauf. Bewertung, Quartalszahlen, Ausblick und Nachrichten
fließen nicht ein – das ist eine Auswahl nach Regeln, keine Kaufempfehlung.
"""
ANZAHL_BEREICHE = 10
ANZAHL_SEKTOREN = 3
ANZAHL_AKTIEN = 10
ZEITRAEUME = ("monat", "quartal", "halbjahr", "jahr")
HOECHSTER_ABSTAND_HOCH = 15.0

REGELN = {
    "anzahl_bereiche": ANZAHL_BEREICHE,
    "anzahl_sektoren": ANZAHL_SEKTOREN,
    "anzahl_aktien": ANZAHL_AKTIEN,
    "hoechster_abstand_hoch": HOECHSTER_ABSTAND_HOCH,
}


def rangplaetze(werte: dict) -> dict:
    """Je Schlüssel: besser als so viel Prozent der übrigen (0 bis 100), gleiche Werte gleich."""
    geordnet = sorted(werte, key=werte.get)
    n = len(geordnet)
    ergebnis, i = {}, 0
    while i < n:
        j = i
        while j + 1 < n and werte[geordnet[j + 1]] == werte[geordnet[i]]:
            j += 1
        for x in range(i, j + 1):
            ergebnis[geordnet[x]] = ((i + j) / 2) / (n - 1) * 100 if n > 1 else 100.0
        i = j + 1
    return ergebnis


def mittel_der_raenge(eintraege: list, kennzahlen) -> dict:
    """Mittelwert der Rangplätze über mehrere Kennzahlen; kennzahlen liefert je Eintrag eine Liste."""
    spalten = list(zip(*[kennzahlen(e) for e in eintraege])) if eintraege else []
    raenge = [rangplaetze(dict(enumerate(spalte))) for spalte in spalten]
    return {i: sum(r[i] for r in raenge) / len(raenge) for i in range(len(eintraege))}


def bereiche(region: dict) -> list:
    alle = [(gruppe, b) for gruppe in ("sektoren", "themen") for b in region.get(gruppe, [])
            if all(b["werte"].get(k) is not None for k in ZEITRAEUME)]
    punkte = mittel_der_raenge(alle, lambda e: [e[1]["werte"][k] for k in ZEITRAEUME])
    liste = [{"name": b["name"], "gruppe": gruppe, "punkte": round(punkte[i], 1),
              "werte": {k: b["werte"].get(k) for k in ZEITRAEUME}} for i, (gruppe, b) in enumerate(alle)]
    return sorted(liste, key=lambda b: -b["punkte"])


def zugelassen(a: dict) -> bool:
    t, m = a.get("trend"), a.get("muster")
    return bool(t and t["ueber_200"] and t["durchschnitt_50_ueber_200"]
                and t["abstand_hoch"] >= -HOECHSTER_ABSTAND_HOCH and t["schwankung"] > 0
                and m and m["phase"] == 2)


# Reihenfolge: erst alle Regeln erfüllt, dann beobachten, dann der Rest – je nach Momentum-Wert
EINSTUFUNG_RANG = {"erfuellt": 0, "beobachten": 1, None: 2}


def aktien(daten: dict, sektoren: list) -> tuple[list, int, int]:
    """Die besten Aktien der Sektoren, dazu wie viele geprüft und wie viele zugelassen wurden."""
    kandidaten = [a for a in daten["aktien"] if a["sektor"] in sektoren]
    zugelassen_liste = [a for a in kandidaten if zugelassen(a)]
    punkte = mittel_der_raenge(zugelassen_liste, lambda a: [
        a["trend"]["zwoelf_ohne_letzten"] / a["trend"]["schwankung"],
        a["trend"]["sechs_ohne_letzten"] / a["trend"]["schwankung"]])
    liste = [{**{k: a[k] for k in ("ticker", "name", "sektor", "index", "indizes", "werte", "trend", "muster")},
              "punkte": round(punkte[i], 1)} for i, a in enumerate(zugelassen_liste)]
    liste.sort(key=lambda a: (EINSTUFUNG_RANG[a["muster"]["einstufung"]], -a["punkte"]))
    return liste[:ANZAHL_AKTIEN], len(kandidaten), len(zugelassen_liste)


def auswerten(stand: dict) -> dict:
    ergebnis = {"regeln": REGELN}
    for region in stand["regionen"]:
        rangliste = bereiche(region)
        # Rang unter den Sektoren allein, weil die Aktien nur nach Sektoren eingeordnet sind
        sektoren = [b["name"] for b in rangliste if b["gruppe"] == "sektoren"][:ANZAHL_SEKTOREN]
        daten = (stand.get("aktien") or {}).get(region["schluessel"])
        beste, geprueft, zugelassen_zahl = aktien(daten, sektoren) if daten else ([], 0, 0)
        ergebnis[region["schluessel"]] = {
            "bereiche": rangliste[:ANZAHL_BEREICHE],
            "sektoren": sektoren,
            "aktien": beste,
            "geprueft": geprueft,
            "zugelassen": zugelassen_zahl,
            "erfuellt": sum(1 for a in beste if a["muster"]["einstufung"] == "erfuellt"),
        }
    return ergebnis
