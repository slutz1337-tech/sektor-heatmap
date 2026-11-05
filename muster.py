"""Sektor-Heatmap – Phase und Ausbruchsmuster je Aktie, nach festen Regeln.

Phasen nach Stan Weinstein, gemessen am Durchschnitt der letzten 150 Handelstage (30 Wochen).
„Steigt“ und „fällt“ heißt: mehr als 0,5 Prozent in 20 Handelstagen.
  Phase 1  Bodenbildung   Durchschnitt flach nach einem Abwärtstrend – oder Kurs schon über dem fallenden
  Phase 2  Aufwärtsphase  Durchschnitt steigt, Kurs darüber
  Phase 3  Topbildung     Durchschnitt flach nach einem Aufwärtstrend – oder Kurs unter den steigenden gefallen
  Phase 4  Abwärtsphase   Durchschnitt fällt, Kurs darunter
Warnzeichen: der größte Wochenverlust des letzten halben Jahres (mehr als 5 Prozent) fiel in die
letzten zwei Wochen – nach Weinstein oft das erste Zeichen von Phase 3.

Ausbruch über eine Bodenbildung:
  Ausbruchsmarke = höchster Schlusskurs der rund sechs Monate (125 Handelstage) vor den letzten zehn
  Handelstagen. Eine Bodenbildung liegt nur vor, wenn dieses Hoch mindestens 15 Handelstage vor
  dem Ende des Zeitraums lag (der Kurs hat sich darunter gesammelt) und der Rücksetzer danach
  höchstens 35 Prozent tief war.
  Ausbruch    in den letzten zehn Handelstagen erstmals über der Marke geschlossen; „mit Volumen“,
              wenn das Handelsvolumen an dem Tag mindestens das 1,4-Fache des 50-Tage-Durchschnitts war
  Gescheitert danach mehr als 3 Prozent unter die Marke zurückgefallen
  An der Marke höchstens 5 Prozent darunter, noch nicht ausgebrochen

Einstufung:
  „Alle Regeln erfüllt“  Phase 2, Ausbruch mit Volumen, kein Warnzeichen, höchstens 25 Prozent über
                         dem 50-Tage-Durchschnitt (sonst weit gelaufen, Rücksetzer wahrscheinlich)
  „Beobachten“           Phase 2, an der Marke oder Ausbruch ohne erhöhtes Volumen, kein Warnzeichen,
                         nicht weit gelaufen
"""
import pandas as pd

PHASE_DURCHSCHNITT = 150
STEIGUNG_TAGE = 20
VORHER_TAGE = 60
STEIGUNG_SCHWELLE = 0.5
WARN_WOCHEN = 26
WARN_VERLUST = -5.0
AUSBRUCH_FENSTER = 10
BASIS_TAGE = 125
MINDEST_TAGE_UNTER_MARKE = 15
HOECHSTE_TIEFE = 35.0
VOLUMEN_FAKTOR = 1.4
NAHE_MARKE = 5.0
GEHALTEN = 3.0
WEIT_GELAUFEN = 25.0
CHART_TAGE = 250

PHASEN = {1: "Bodenbildung", 2: "Aufwärtsphase", 3: "Topbildung", 4: "Abwärtsphase"}


def phase(schluss: pd.Series) -> int | None:
    if len(schluss) < PHASE_DURCHSCHNITT + STEIGUNG_TAGE + VORHER_TAGE:
        return None
    schnitt = schluss.rolling(PHASE_DURCHSCHNITT).mean()
    steigung = (schnitt.iloc[-1] / schnitt.iloc[-1 - STEIGUNG_TAGE] - 1) * 100
    vorher = (schnitt.iloc[-1 - STEIGUNG_TAGE] / schnitt.iloc[-1 - STEIGUNG_TAGE - VORHER_TAGE] - 1) * 100
    darueber = schluss.iloc[-1] > schnitt.iloc[-1]
    if steigung > STEIGUNG_SCHWELLE:
        return 2 if darueber else 3
    if steigung < -STEIGUNG_SCHWELLE:
        return 1 if darueber else 4
    return 3 if vorher > 0 else 1


def warnzeichen(schluss: pd.Series) -> float | None:
    """Wochenverlust in Prozent, wenn der größte des letzten halben Jahres in den letzten zwei Wochen lag."""
    wochen = schluss.resample("W-FRI").last().pct_change().dropna().iloc[-WARN_WOCHEN:] * 100
    if len(wochen) < 8:
        return None
    tag = wochen.idxmin()
    if wochen[tag] < WARN_VERLUST and tag >= wochen.index[-2]:
        return round(float(wochen[tag]), 1)
    return None


def ausbruch(schluss: pd.Series, volumen: pd.Series | None) -> dict | None:
    n = len(schluss)
    if n < BASIS_TAGE + AUSBRUCH_FENSTER + 50:
        return None
    basis = schluss.iloc[n - AUSBRUCH_FENSTER - BASIS_TAGE:n - AUSBRUCH_FENSTER]
    hoch = int(basis.values.argmax())
    marke = float(basis.iloc[hoch])
    if len(basis) - 1 - hoch < MINDEST_TAGE_UNTER_MARKE:
        return None  # keine Bodenbildung: der Kurs lief bis zuletzt auf neue Hochs
    tiefe = (1 - basis.iloc[hoch:].min() / marke) * 100
    if tiefe > HOECHSTE_TIEFE:
        return None
    ergebnis = {"marke": float(f"{marke:.5g}"), "seit": basis.index[hoch].date().isoformat(),
                "tiefe": round(float(tiefe), 1), "wochen": round((len(basis) - hoch + AUSBRUCH_FENSTER) / 5)}
    kurs = float(schluss.iloc[-1])
    letzte = schluss.iloc[-AUSBRUCH_FENSTER:]
    darueber = letzte[letzte > marke]
    if len(darueber):
        tag = darueber.index[0]
        faktor = None
        if volumen is not None:
            v = volumen.reindex(schluss.index)
            schnitt = v.rolling(50, min_periods=30).mean().shift(1).loc[tag]
            if pd.notna(schnitt) and schnitt > 0 and pd.notna(v.loc[tag]):
                faktor = round(float(v.loc[tag] / schnitt), 1)
        if kurs < marke * (1 - GEHALTEN / 100):
            art = "gescheitert"
        else:
            art = "ausbruch" if faktor is not None and faktor >= VOLUMEN_FAKTOR else "ausbruch_leise"
        return {**ergebnis, "art": art, "tag": tag.date().isoformat(), "volumen_faktor": faktor}
    abstand = (kurs / marke - 1) * 100
    if abstand >= -NAHE_MARKE:
        return {**ergebnis, "art": "an_der_marke", "abstand": round(abstand, 1)}
    return None


def auswerten(tafel: pd.DataFrame) -> dict | None:
    schluss = tafel["Close"]
    p = phase(schluss)
    if p is None:
        return None
    volumen = tafel["Volume"] if "Volume" in tafel and tafel["Volume"].fillna(0).gt(0).any() else None
    a = ausbruch(schluss, volumen)
    warnung = warnzeichen(schluss)
    ueber_50 = round(float((schluss.iloc[-1] / schluss.iloc[-50:].mean() - 1) * 100), 1)
    weit = ueber_50 > WEIT_GELAUFEN
    art = a["art"] if a else None
    einstufung = None
    if p == 2 and warnung is None and not weit:
        if art == "ausbruch":
            einstufung = "erfuellt"
        elif art in ("an_der_marke", "ausbruch_leise"):
            einstufung = "beobachten"
    return {"phase": p, "phase_name": PHASEN[p], "warnung": warnung, "ueber_50": ueber_50,
            "weit_gelaufen": weit, "ausbruch": a, "einstufung": einstufung}


def chart(tafel: pd.DataFrame) -> dict:
    """Tageskerzen, Volumen und beide Durchschnitte für das letzte Jahr, gerundet auf fünf Stellen."""
    schluss = tafel["Close"]
    teil = tafel.iloc[-CHART_TAGE:]
    zahl = lambda v: None if pd.isna(v) else float(f"{v:.5g}")
    spalte = lambda name: [zahl(v) for v in (teil[name] if name in teil else teil["Close"]).fillna(teil["Close"])]
    return {
        "daten": [d.date().isoformat() for d in teil.index],
        "o": spalte("Open"), "h": spalte("High"), "l": spalte("Low"), "c": spalte("Close"),
        "v": [None if pd.isna(v) else int(v) for v in teil["Volume"]] if "Volume" in teil else [],
        "d50": [zahl(v) for v in schluss.rolling(50).mean().iloc[-CHART_TAGE:]],
        "d150": [zahl(v) for v in schluss.rolling(PHASE_DURCHSCHNITT).mean().iloc[-CHART_TAGE:]],
    }
