// Sektor-Übersicht – elf Sektoren, USA neben Europa, über fünf Zeiträume.
"use strict";

const $ = (id) => document.getElementById(id);
const WEB = window.SEKTOR_MODUS === "web";
const SERVER = location.protocol === "file:" ? "http://127.0.0.1:8771" : "";

const ZEITRAEUME = [["woche", "1 Woche"], ["monat", "1 Monat"], ["quartal", "3 Monate"],
  ["halbjahr", "6 Monate"], ["jahr", "12 Monate"]];
const REGIONEN = ["usa", "europa"];
// Reihenfolge und Bezeichnungen fest vorgegeben; vorn steht der Name in den Daten
const SEKTOREN = [
  ["Technologie", "Informationstechnologie", ""],
  ["Gesundheit", "Gesundheitswesen", ""],
  ["Finanzen", "Finanzen", ""],
  ["Industrie", "Industrie", ""],
  ["Energie", "Energie", ""],
  ["Grundstoffe", "Grundstoffe", ""],
  ["Basiskonsum", "Basiskonsumgüter", "etwa Lebensmittel und Haushaltsprodukte"],
  ["Zyklischer Konsum", "Zyklische Konsumgüter", "etwa Autos und Luxusartikel"],
  ["Kommunikation", "Kommunikationsdienste", "etwa Telekommunikation, Medien und Onlineplattformen"],
  ["Versorger", "Versorger", "etwa Strom- und Wasserversorgung"],
  ["Immobilien", "Immobilien", ""],
];

const zahl = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
const zahl0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0, signDisplay: "exceptZero" });
const prozent = (v) => (v === null || v === undefined) ? "–" :
  (Math.abs(v) >= 100 ? zahl0 : zahl).format(v) + '<span class="einheit"> %</span>';
const datum = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("de-DE") : "–";
const uhrzeit = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function meldung(text, fehler) {
  $("meldung").textContent = text;
  $("meldung").classList.toggle("fehler", !!fehler);
}

function farbe(v, max) {
  if (v === null || v === undefined) return "";
  const anteil = Math.min(1, Math.abs(v) / max);
  const teile = getComputedStyle(document.documentElement).getPropertyValue(v >= 0 ? "--gewinn" : "--verlust").trim();
  // Wurzel, damit kleine Werte noch sichtbar getönt sind
  return `rgba(${teile}, ${(0.12 + 0.83 * Math.sqrt(anteil)).toFixed(3)})`;
}

function zeichnen(stand) {
  const regionen = REGIONEN.map((k) => stand.regionen.find((r) => r.schluessel === k));
  const wert = (region, sektor, z) => {
    const s = region.sektoren.find((x) => x.name === sektor);
    const v = s ? s.werte[z] : null;
    return v === undefined ? null : v;
  };
  // Größter Betrag je Zeitraum über beide Regionen = volle Farbe
  const max = {};
  for (const [z] of ZEITRAEUME) {
    max[z] = Math.max(1e-9, ...regionen.flatMap((r) => SEKTOREN.map(([s]) => Math.abs(wert(r, s, z) || 0))));
  }

  $("stand").textContent = `Abgerufen am ${uhrzeit(stand.abgerufen)} · ` +
    regionen.map((r) => `${r.name}: Schlusskurse vom ${datum(r.stand)}`).join(" · ");

  // Am Handy nur die Zahl in der Spalte, „Woche“ und „Monate“ stehen dann gemeinsam darunter
  const zeitKopf = ZEITRAEUME.map(([, name]) => {
    const [anzahl, einheit] = name.split(" ");
    return `<th scope="col">${anzahl}<span class="zeit-wort"> ${einheit}</span></th>`;
  }).join("");
  const zeitWorte = '<th>Woche</th><th>Monate</th>';
  const werte = (region, sektor) => ZEITRAEUME.map(([z]) => {
    const v = wert(region, sektor, z);
    return `<td class="wert${v === null ? " leer" : ""}" style="background:${farbe(v, max[z])}">${prozent(v)}</td>`;
  }).join("");

  $("uebersicht").innerHTML = `<table class="uebersicht">
    <thead>
      <tr class="region"><th class="ecke" scope="col">Sektor</th>
        <th colspan="5" scope="colgroup">${esc(regionen[0].name)}</th><th class="luecke" aria-hidden="true"></th>
        <th colspan="5" scope="colgroup">${esc(regionen[1].name)}</th></tr>
      <tr class="zeitraeume"><th class="ecke"></th>${zeitKopf}<th class="luecke" aria-hidden="true"></th>${zeitKopf}</tr>
      <tr class="zeit-worte" aria-hidden="true">${zeitWorte}<th class="luecke"></th>${zeitWorte}</tr>
    </thead>
    <tbody>${SEKTOREN.map(([s, name, zusatz]) => `<tr>
      <th class="sektor" scope="row">${esc(name)}${zusatz ? `<small>${esc(zusatz)}</small>` : ""}</th>
      ${werte(regionen[0], s)}<td class="luecke" aria-hidden="true"></td>${werte(regionen[1], s)}
    </tr>`).join("")}</tbody>
  </table>`;
}

async function aktualisieren() {
  if (WEB) {
    meldung("Lade die neueste Fassung …");
    const adresse = new URL(location.href);
    adresse.searchParams.set("neu", Date.now());  // am Zwischenspeicher des Browsers vorbei
    location.replace(adresse.toString());
    return;
  }
  const knopf = $("aktualisieren");
  knopf.disabled = true;
  meldung("Kurse werden geholt, das dauert rund eine Minute …");
  try {
    let antwort;
    try {
      antwort = await fetch(SERVER + "/api/aktualisieren", { method: "POST" });
    } catch (netz) {
      throw new Error(SERVER
        ? "das Programm läuft nicht. Bitte über das Symbol „Sektor-Heatmap“ auf dem Desktop starten"
        : "der Server antwortet nicht");
    }
    const daten = await antwort.json();
    if (!antwort.ok) throw new Error(daten.fehler || "Abruf fehlgeschlagen");
    zeichnen(daten);
    meldung("Aktualisiert.");
    setTimeout(() => meldung(""), 4000);
  } catch (fehler) {
    meldung("Aktualisieren fehlgeschlagen: " + fehler.message + " – angezeigt ist der letzte Stand.", true);
  } finally {
    knopf.disabled = false;
  }
}

async function start() {
  $("aktualisieren").addEventListener("click", aktualisieren);
  if (window.SEKTOR_STAND) {  // gespeicherte HTML-Datei aus export.py: Stand steckt in der Seite
    zeichnen(window.SEKTOR_STAND);
    if (WEB) meldung("Kurse werden an Börsentagen stündlich neu geholt.");
    return;
  }
  try {
    const daten = await (await fetch("/api/heatmap")).json();
    if (daten.leer) { $("stand").textContent = "Noch kein Stand vorhanden."; return aktualisieren(); }
    zeichnen(daten);
  } catch (fehler) {
    meldung("Server nicht erreichbar: " + fehler.message, true);
  }
}
start();
