"""Sektor-Heatmap – den Stand als eigenständige HTML-Datei speichern.

Seite, Gestaltung, Skript und Daten landen in einer einzigen Datei, die ohne Server und ohne
Internet im Browser läuft. Abgelegt immer unter demselben Namen
DeepWork_V1\\Sektor-Heatmap\\Sektor-Heatmap.html; jedes Aktualisieren über den Server
schreibt sie neu. Ihr Knopf „Aktualisieren“ wirkt, solange das Programm am Rechner läuft.

Aufruf:  py export.py         letzten abgelegten Stand speichern
         py export.py --neu   vorher frische Kurse holen (rund eine Minute)
Für die öffentliche Seite (GitHub):  python export.py --neu --web --ziel _site/index.html
         --web    Knopf „Aktualisieren“ lädt die Seite neu, statt das Programm am Rechner zu fragen
         --ziel   anderer Speicherort
"""
import json
import pathlib
import sys

import kurse

STATIC = pathlib.Path(__file__).resolve().parent / "static"


def erzeugen(stand: dict, web: bool = False) -> str:
    seite = (STATIC / "index.html").read_text(encoding="utf-8")
    stil = (STATIC / "stil.css").read_text(encoding="utf-8")
    skript = (STATIC / "app.js").read_text(encoding="utf-8")
    # "</" maskieren, damit kein Text in den Daten den Skriptblock vorzeitig schließt
    daten = json.dumps(stand, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    modus = ' window.SEKTOR_MODUS = "web";' if web else ""
    ersetzungen = [
        ('<link rel="stylesheet" href="stil.css">', f"<style>\n{stil}\n</style>"),
        ('<script src="app.js"></script>',
         f"<script>window.SEKTOR_STAND = {daten};{modus}</script>\n<script>\n{skript}\n</script>"),
    ]
    for alt, neu in ersetzungen:
        if alt not in seite:
            raise RuntimeError(f"In index.html fehlt: {alt}")
        seite = seite.replace(alt, neu)
    return seite


def erzeugen_uebersicht(stand: dict, web: bool = False) -> str:
    """Sektor-Übersicht: nur die Sektoren je Region, die Seite bleibt damit klein."""
    knapp = {"abgerufen": stand["abgerufen"], "regionen": [
        {"schluessel": r["schluessel"], "name": r["name"], "stand": r["stand"],
         "sektoren": [{"name": s["name"], "werte": s["werte"]} for s in r["sektoren"]]}
        for r in stand["regionen"]]}
    seite = (STATIC / "uebersicht.html").read_text(encoding="utf-8")
    stil = (STATIC / "stil.css").read_text(encoding="utf-8")
    stil_eigen = (STATIC / "uebersicht.css").read_text(encoding="utf-8")
    skript = (STATIC / "uebersicht.js").read_text(encoding="utf-8")
    daten = json.dumps(knapp, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    modus = ' window.SEKTOR_MODUS = "web";' if web else ""
    ersetzungen = [
        ('<link rel="stylesheet" href="stil.css">', f"<style>\n{stil}\n</style>"),
        ('<link rel="stylesheet" href="uebersicht.css">', f"<style>\n{stil_eigen}\n</style>"),
        ('<script src="uebersicht.js"></script>',
         f"<script>window.SEKTOR_STAND = {daten};{modus}</script>\n<script>\n{skript}\n</script>"),
    ]
    for alt, neu in ersetzungen:
        if alt not in seite:
            raise RuntimeError(f"In uebersicht.html fehlt: {alt}")
        seite = seite.replace(alt, neu)
    return seite


def speichern(stand: dict, ziel: pathlib.Path | None = None, web: bool = False) -> pathlib.Path:
    """Schreibt die Heatmap und daneben die Sektor-Übersicht als uebersicht.html."""
    ziel = ziel or kurse.ABLAGE / "Sektor-Heatmap.html"
    ziel.parent.mkdir(parents=True, exist_ok=True)
    ziel.write_text(erzeugen(stand, web), encoding="utf-8")
    (ziel.parent / "uebersicht.html").write_text(erzeugen_uebersicht(stand, web), encoding="utf-8")
    return ziel


if __name__ == "__main__":
    stand = kurse.aktualisieren() if "--neu" in sys.argv else kurse.laden()
    if not stand:
        sys.exit("Noch kein Stand vorhanden – mit „py export.py --neu“ zuerst Kurse holen.")
    ziel = pathlib.Path(sys.argv[sys.argv.index("--ziel") + 1]) if "--ziel" in sys.argv else None
    pfad = speichern(stand, ziel, web="--web" in sys.argv)
    print(f"Gespeichert: {pfad}  ({pfad.stat().st_size // 1024} Kilobyte, Stand {stand['abgerufen']})")
