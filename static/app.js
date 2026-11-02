// Sektor-Heatmap – Oberfläche. Liest /api/heatmap, zeichnet je Region eine Tabelle.
"use strict";

const zustand = { stand: null, sortierung: null, richtung: -1, aktienZeitraum: "jahr",
  topZeitraum: "gesamt", topIndex: { europa: "", usa: "" } };
const $ = (id) => document.getElementById(id);

const zahl = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
const zahl2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero" });
const zahl0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0, signDisplay: "exceptZero" });
// ab 100 Prozent ohne Nachkommastelle, damit die Zelle einzeilig bleibt
const prozent = (v, genau) => (v === null || v === undefined) ? "–" :
  (genau ? zahl2 : Math.abs(v) >= 100 ? zahl0 : zahl).format(v) + " %";
const datum = (iso) => iso ? new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("de-DE") : "–";
const uhrzeit = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const GRUPPEN = [
  { schluessel: "sektoren", titel: "Sektoren", spalte: "Sektor" },
  { schluessel: "themen", titel: "Branchen und Themen", spalte: "Branche oder Thema" },
];

// Farbskala je Gruppe und Zeitraum: größter Betrag über beide Regionen (ohne Gesamtmarkt)
// = volle Farbe. Die Themen schwanken stärker und bekommen deshalb ihre eigene Skala.
function skalen(stand, gruppe) {
  const max = {};
  for (const z of stand.zeitraeume) {
    let m = 0;
    for (const r of stand.regionen) for (const s of (r[gruppe] || [])) {
      const v = s.werte[z.schluessel];
      if (v !== null) m = Math.max(m, Math.abs(v));
    }
    max[z.schluessel] = m || 1;
  }
  return max;
}

function farbe(v, max) {
  if (v === null || v === undefined) return "";
  const anteil = Math.min(1, Math.abs(v) / max);
  const teile = getComputedStyle(document.documentElement).getPropertyValue(v >= 0 ? "--gewinn" : "--verlust").trim();
  // Wurzel, damit kleine Werte noch sichtbar getönt sind
  return `rgba(${teile}, ${(0.12 + 0.83 * Math.sqrt(anteil)).toFixed(3)})`;
}

function sortiert(sektoren) {
  const liste = sektoren.slice();
  const k = zustand.sortierung;
  if (!k) return liste;
  return liste.sort((a, b) => {
    const x = a.werte[k], y = b.werte[k];
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * zustand.richtung;
  });
}

function karte(region, stand, max, gruppe) {
  const kopf = stand.zeitraeume.map((z) => {
    const aktiv = zustand.sortierung === z.schluessel;
    const sort = aktiv ? (zustand.richtung < 0 ? "descending" : "ascending") : "none";
    return `<th scope="col"><button type="button" data-sort="${z.schluessel}" aria-sort="${sort}">${esc(z.name).replace("Jahresbeginn", "Jahres­beginn")}</button></th>`;
  }).join("");

  const zeile = (s, gesamt) => {
    const zellen = stand.zeitraeume.map((z) => {
      const k = z.schluessel, v = s.werte[k];
      const zeichen = gesamt ? "" :
        (s.uneinig[k] ? '<i class="punkt"></i>' : "") +
        (s.fonds.some((f) => f.ausreisser.includes(k)) ? '<i class="ring"></i>' : "");
      return `<td class="zelle${v === null ? " leer" : ""}" tabindex="0" data-region="${region.schluessel}" data-gruppe="${gruppe.schluessel}"
        data-sektor="${esc(s.name)}" data-zeitraum="${k}" style="background:${farbe(v, max[k])}">${prozent(v)}${zeichen}</td>`;
    }).join("");
    const anzahl = gesamt ? "" : `<small>${s.fonds.length} Fonds</small>`;
    return `<tr class="${gesamt ? "gesamt" : ""}"><td class="name" title="${esc(s.name)}">${esc(s.name)}${anzahl}</td>${zellen}</tr>`;
  };

  const gesamt = region.gesamtmarkt;
  const gesamtZeile = zeile({ name: "Gesamtmarkt", werte: gesamt.werte, fonds: [gesamt] }, true);

  const id = `titel-${gruppe.schluessel}-${region.schluessel}`;
  return `<section class="karte" aria-labelledby="${id}">
    <h2 id="${id}">${esc(region.name)}</h2>
    <p class="unterzeile">Schlusskurse vom ${datum(region.stand)} · Börse ${esc(region.boerse)} · in ${esc(region.waehrung)} ·
      Gesamtmarkt: ${esc(gesamt.name)}</p>
    <div class="tabelle-rahmen"><table>
      <thead><tr><th scope="col"><button type="button" data-sort="">${gruppe.spalte}</button></th>${kopf}</tr></thead>
      <tbody>${sortiert(region[gruppe.schluessel] || []).map((s) => zeile(s, false)).join("")}${gesamtZeile}</tbody>
    </table></div>
  </section>`;
}

function grundlage(stand) {
  return stand.regionen.map((r) => {
    const zeilen = r.sektoren.concat(r.themen || []).flatMap((s) => s.fonds.map((f, i) => `<tr>
        <td>${i === 0 ? esc(s.name) : ""}</td><td>${esc(f.name)}</td><td>${esc(f.ticker)}</td>
        <td>${datum(f.letzter_kurs)}</td>
        <td class="${f.ausgeschlossen || f.ausreisser.length ? "warnung" : ""}">${
          f.ausgeschlossen ? esc(f.ausgeschlossen) :
          f.ausreisser.length ? "Ausreißer bei: " + f.ausreisser.map((k) => stand.zeitraeume.find((z) => z.schluessel === k).name).join(", ") :
          "gezählt"}</td></tr>`)).join("");
    return `<h3>${esc(r.name)}</h3><table>
      <thead><tr><th>Sektor, Branche oder Thema</th><th>Fonds</th><th>Kürzel</th><th>Letzter Kurs</th><th>Status</th></tr></thead>
      <tbody>${zeilen}</tbody></table>`;
  }).join("");
}

function zeichnen() {
  const stand = zustand.stand;
  if (!stand) return;
  $("karten").innerHTML = GRUPPEN.map((g) => {
    const max = skalen(stand, g.schluessel);
    const hinweis = g.schluessel === "themen"
      ? `<p class="gruppen-hinweis">Feiner geschnitten als die Sektoren und mit eigener Farbskala. Europa: Branchen des STOXX Europe 600 und Rüstung. USA: Branchen und Themen über Fonds, die in New York gehandelt werden – einige davon (Saubere Energie, Uran, Goldminen, Lithium, Robotik) enthalten auch Firmen außerhalb der USA.</p>`
      : "";
    return `<h2 class="gruppe">${g.titel}</h2>${hinweis}<div class="karten-reihe">${
      stand.regionen.map((r) => karte(r, stand, max, g)).join("")}</div>`;
  }).join("");
  aktienZeichnen();
  topZeichnen();
  $("grundlage").innerHTML = grundlage(stand) + aktienGrundlage(stand);
  $("stand").textContent = "Abgerufen am " + uhrzeit(stand.abgerufen) + " · " +
    stand.regionen.map((r) => `${r.name}: Schlusskurse vom ${datum(r.stand)}`).join(" · ");
}

// ---------- Beste Aktien der vier stärksten Sektoren ----------
const ANZAHL_SEKTOREN = 4, ANZAHL_AKTIEN = 10;

// Farbskala der Aktien je Zeitraum: 90. Perzentil der Beträge aller Aktien beider Regionen,
// damit einzelne Vervielfacher die übrigen Zellen nicht ausbleichen.
function aktienSkalen(stand) {
  const max = {};
  for (const z of stand.zeitraeume) {
    const betraege = [];
    for (const r of Object.values(stand.aktien)) for (const a of r.aktien) {
      const v = a.werte[z.schluessel];
      if (v !== null && v !== undefined) betraege.push(Math.abs(v));
    }
    betraege.sort((x, y) => x - y);
    max[z.schluessel] = betraege.length ? Math.max(1, betraege[Math.floor(betraege.length * 0.9)]) : 1;
  }
  return max;
}

function aktienKarte(region, stand, max) {
  const k = zustand.aktienZeitraum;
  const daten = stand.aktien[region.schluessel];
  const zeitraumName = stand.zeitraeume.find((z) => z.schluessel === k).name;
  const sektoren = region.sektoren.filter((s) => s.werte[k] !== null && s.werte[k] !== undefined)
    .sort((a, b) => b.werte[k] - a.werte[k]).slice(0, ANZAHL_SEKTOREN);
  const kopf = stand.zeitraeume.map((z) =>
    `<th scope="col" class="${z.schluessel === k ? "aktiv" : ""}">${esc(z.name).replace("Jahresbeginn", "Jahres\u00ADbeginn")}</th>`).join("");

  const bloecke = sektoren.map((s, i) => {
    const alle = daten.aktien.filter((a) => a.sektor === s.name);
    const beste = alle.filter((a) => a.werte[k] !== null && a.werte[k] !== undefined)
      .sort((a, b) => b.werte[k] - a.werte[k]).slice(0, ANZAHL_AKTIEN);
    const zeilen = beste.map((a, rang) => `<tr>
        <td class="rang">${rang + 1}</td>
        <td class="name" title="${esc(a.name)} · ${esc(a.ticker)} · ${esc(a.index)}">${esc(a.name)}<small>${esc(a.ticker)} · ${esc(a.index)}</small></td>
        ${stand.zeitraeume.map((z) => {
          const v = a.werte[z.schluessel];
          return `<td class="zelle aktie${v === null ? " leer" : ""}${z.schluessel === k ? " aktiv" : ""}"
            style="background:${farbe(v, max[z.schluessel])}">${prozent(v)}</td>`;
        }).join("")}</tr>`).join("");
    return `<div class="aktien-block">
      <h3><span class="platz">${i + 1}.</span> ${esc(s.name)}
        <span class="sektorwert">Sektor ${prozent(s.werte[k])} · ${alle.length} Aktien in der Auswahl</span></h3>
      ${beste.length ? `<div class="tabelle-rahmen"><table class="aktien-tabelle">
        <thead><tr><th scope="col" class="rang">Platz</th><th scope="col">Aktie</th>${kopf}</tr></thead>
        <tbody>${zeilen}</tbody></table></div>` : `<p class="grau">Keine Aktie mit Kursen für ${esc(zeitraumName)}.</p>`}
    </div>`;
  }).join("");

  return `<section class="karte">
    <h2>${esc(region.name)}</h2>
    <p class="unterzeile">Rangfolge nach ${esc(zeitraumName)} · ${daten.aktien.length} Aktien aus ${
      esc(daten.quellen.join(", "))} · Kurse in der Währung des Börsenplatzes</p>
    ${bloecke}
  </section>`;
}

function aktienZeichnen() {
  const stand = zustand.stand;
  if (!stand.aktien) {
    $("aktien-hinweis").textContent = "Für diesen Stand liegen noch keine Aktienkurse vor – bitte „Aktualisieren“ drücken.";
    $("zeitraum-wahl").innerHTML = "";
    $("aktien").innerHTML = "";
    return;
  }
  $("aktien-hinweis").textContent = "Die vier Sektoren mit der besten Entwicklung im gewählten Zeitraum, "
    + "darin die zehn Aktien mit der besten Entwicklung im selben Zeitraum. Die übrigen Spalten zeigen "
    + "dieselben Aktien über die anderen Zeiträume. Ein Klick auf eine Spalte der Heatmap wählt den "
    + "Zeitraum ebenfalls. Vergangene Entwicklung, keine Empfehlung.";
  $("zeitraum-wahl").innerHTML = "<span>Rangfolge nach</span>" + stand.zeitraeume.map((z) =>
    `<button type="button" data-zeitraum="${z.schluessel}" aria-pressed="${z.schluessel === zustand.aktienZeitraum}">${esc(z.name)}</button>`).join("");
  const max = aktienSkalen(stand);
  $("aktien").innerHTML = stand.regionen.map((r) => aktienKarte(r, stand, max)).join("");
}

function aktienGrundlage(stand) {
  if (!stand.aktien) return "";
  return stand.regionen.map((r) => {
    const d = stand.aktien[r.schluessel];
    const heraus = d.heraus.length
      ? "<ul>" + d.heraus.map((h) => `<li>${esc(h.name)} (${esc(h.ticker)}): ${esc(h.grund)}</li>`).join("") + "</ul>"
      : '<p class="grau">Keine Aktie herausgenommen.</p>';
    return `<h3>Aktien ${esc(r.name)}</h3>
      <p>${d.aktien.length} Aktien gezählt aus ${esc(d.quellen.join(", "))} (Mitgliederlisten von Wikipedia,
      Stand ${datum(d.mitglieder_stand)}, monatlich erneuert).</p>${heraus}`;
  }).join("");
}

$("zeitraum-wahl").addEventListener("click", (e) => {
  const knopf = e.target.closest("button[data-zeitraum]");
  if (!knopf) return;
  zustand.aktienZeitraum = knopf.dataset.zeitraum;
  aktienZeichnen();
  const neu = document.querySelector(`#zeitraum-wahl button[data-zeitraum="${zustand.aktienZeitraum}"]`);
  if (neu) neu.focus();
});

// ---------- Top 30 je Region und Index ----------
const ANZAHL_TOP = 30, MINDEST_ZEITRAEUME = 6;

// „Über alle Zeiträume“: je Zeitraum der Anteil der Aktien derselben Auswahl, die schlechter
// abgeschnitten haben (0 bis 100 Prozent); davon der Mittelwert. Eine Aktie braucht Werte in
// mindestens sechs der sieben Zeiträume, damit junge Börsengänge nicht mit einem Wert gewinnen.
function gesamtwerte(aktien, zeitraeume) {
  const anteil = new Map(aktien.map((a) => [a, []]));
  for (const z of zeitraeume) {
    const k = z.schluessel;
    const mit = aktien.filter((a) => a.werte[k] !== null && a.werte[k] !== undefined)
      .sort((a, b) => a.werte[k] - b.werte[k]);
    const n = mit.length;
    let i = 0;
    while (i < n) {  // gleiche Werte bekommen denselben Rang
      let j = i;
      while (j + 1 < n && mit[j + 1].werte[k] === mit[i].werte[k]) j++;
      const rang = n > 1 ? ((i + j) / 2) / (n - 1) * 100 : 100;
      for (let x = i; x <= j; x++) anteil.get(mit[x]).push(rang);
      i = j + 1;
    }
  }
  const ergebnis = new Map();
  for (const [a, liste] of anteil) {
    if (liste.length >= MINDEST_ZEITRAEUME) ergebnis.set(a, liste.reduce((x, y) => x + y, 0) / liste.length);
  }
  return ergebnis;
}

function topKarte(region, stand, max) {
  const daten = stand.aktien[region.schluessel];
  const index = zustand.topIndex[region.schluessel];
  const auswahl = index ? daten.aktien.filter((a) => (a.indizes || [a.index]).includes(index)) : daten.aktien;
  const k = zustand.topZeitraum;
  const gesamt = gesamtwerte(auswahl, stand.zeitraeume);
  const wert = (a) => k === "gesamt" ? gesamt.get(a) : a.werte[k];
  const beste = auswahl.filter((a) => wert(a) !== null && wert(a) !== undefined)
    .sort((a, b) => wert(b) - wert(a)).slice(0, ANZAHL_TOP);

  const indizes = [...new Set(daten.aktien.flatMap((a) => a.indizes || [a.index]))];
  const reihenfolge = daten.quellen.filter((q) => indizes.includes(q));
  const auswahlListe = [`<option value="">Alle Indizes (${daten.aktien.length} Aktien)</option>`]
    .concat(reihenfolge.map((q) => {
      const n = daten.aktien.filter((a) => (a.indizes || [a.index]).includes(q)).length;
      return `<option value="${esc(q)}"${q === index ? " selected" : ""}>${esc(q)} (${n} Aktien)</option>`;
    })).join("");

  const kopf = stand.zeitraeume.map((z) =>
    `<th scope="col" class="${z.schluessel === k ? "aktiv" : ""}">${esc(z.name).replace("Jahresbeginn", "Jahres\u00ADbeginn")}</th>`).join("");
  const zeilen = beste.map((a, rang) => `<tr>
      <td class="rang">${rang + 1}</td>
      <td class="name" title="${esc(a.name)} · ${esc(a.ticker)} · ${esc((a.indizes || [a.index]).join(", "))}">${esc(a.name)}
        <small>${esc(a.ticker)} · ${esc(a.sektor)} · ${esc((a.indizes || [a.index]).join(", "))}</small></td>
      ${stand.zeitraeume.map((z) => {
        const v = a.werte[z.schluessel];
        return `<td class="zelle aktie${v === null ? " leer" : ""}${z.schluessel === k ? " aktiv" : ""}"
          style="background:${farbe(v, max[z.schluessel])}">${prozent(v)}</td>`;
      }).join("")}
      <td class="zelle aktie gesamt-wert${k === "gesamt" ? " aktiv" : ""}">${
        gesamt.has(a) ? Math.round(gesamt.get(a)) + " %" : "–"}</td></tr>`).join("");

  return `<section class="karte">
    <div class="karte-kopf">
      <h2>${esc(region.name)}</h2>
      <label class="index-wahl">Index
        <select data-region="${region.schluessel}">${auswahlListe}</select></label>
    </div>
    <p class="unterzeile">${auswahl.length} Aktien in der Auswahl · Kurse in der Währung des Börsenplatzes</p>
    ${beste.length ? `<div class="tabelle-rahmen"><table class="aktien-tabelle top-tabelle">
      <thead><tr><th scope="col" class="rang">Platz</th><th scope="col">Aktie</th>${kopf}
        <th scope="col" class="${k === "gesamt" ? "aktiv" : ""}" title="Mittelwert über alle Zeiträume: besser als so viel Prozent der Aktien in der Auswahl">Über alle</th></tr></thead>
      <tbody>${zeilen}</tbody></table></div>` : '<p class="grau">Keine Aktie mit ausreichend Kursen.</p>'}
  </section>`;
}

function topZeichnen() {
  const stand = zustand.stand;
  if (!stand.aktien) { $("top-hinweis").textContent = ""; $("top-wahl").innerHTML = ""; $("top").innerHTML = ""; return; }
  $("top-hinweis").textContent = "Die 30 Aktien mit der besten Entwicklung, je Region aus allen Indizes oder einem gewählten Index. "
    + "„Über alle Zeiträume“ heißt: je Zeitraum wird ermittelt, besser als wie viel Prozent der Aktien in der Auswahl eine "
    + "Aktie abgeschnitten hat, und daraus der Mittelwert gebildet (Spalte „Über alle“; gezählt werden Aktien mit Werten in "
    + "mindestens sechs Zeiträumen). Vergangene Entwicklung, keine Empfehlung.";
  const wahl = [{ schluessel: "gesamt", name: "Über alle Zeiträume" }].concat(stand.zeitraeume);
  $("top-wahl").innerHTML = "<span>Rangfolge nach</span>" + wahl.map((z) =>
    `<button type="button" data-zeitraum="${z.schluessel}" aria-pressed="${z.schluessel === zustand.topZeitraum}">${esc(z.name)}</button>`).join("");
  const max = aktienSkalen(stand);
  $("top").innerHTML = stand.regionen.map((r) => topKarte(r, stand, max)).join("");
}

$("top-wahl").addEventListener("click", (e) => {
  const knopf = e.target.closest("button[data-zeitraum]");
  if (!knopf) return;
  zustand.topZeitraum = knopf.dataset.zeitraum;
  topZeichnen();
  const neu = document.querySelector(`#top-wahl button[data-zeitraum="${zustand.topZeitraum}"]`);
  if (neu) neu.focus();
});
$("top").addEventListener("change", (e) => {
  const wahl = e.target.closest("select[data-region]");
  if (!wahl) return;
  zustand.topIndex[wahl.dataset.region] = wahl.value;
  topZeichnen();
  const neu = document.querySelector(`#top select[data-region="${wahl.dataset.region}"]`);
  if (neu) neu.focus();
});

// ---------- Hinweisfenster an der Zelle ----------
function tippInhalt(zelle) {
  const stand = zustand.stand;
  const region = stand.regionen.find((r) => r.schluessel === zelle.dataset.region);
  const k = zelle.dataset.zeitraum;
  const zeitraum = stand.zeitraeume.find((z) => z.schluessel === k).name;
  const name = zelle.dataset.sektor;
  if (name === "Gesamtmarkt") {
    const g = region.gesamtmarkt;
    return `<strong>Gesamtmarkt ${esc(region.name)}</strong> · ${esc(zeitraum)}
      <div class="wert">${prozent(g.werte[k], true)}</div><span class="grau">${esc(g.name)} (${esc(g.ticker)}),
      letzter Kurs ${datum(g.letzter_kurs)}</span>`;
  }
  const s = region[zelle.dataset.gruppe].find((x) => x.name === name);
  const fonds = s.fonds.map((f) => {
    const weg = f.ausgeschlossen || f.ausreisser.includes(k) || f.werte[k] === null || f.werte[k] === undefined;
    const grund = f.ausgeschlossen ? ` (${esc(f.ausgeschlossen)})` : f.ausreisser.includes(k) ? " (Ausreißer)" :
      (f.werte[k] === null || f.werte[k] === undefined) ? " (Kursreihe zu kurz)" : "";
    return `<tr class="${weg ? "aus" : ""}"><td>${esc(f.name)} <span class="grau">${esc(f.ticker)}</span>${grund}</td>
      <td>${prozent(f.werte[k], true)}</td></tr>`;
  }).join("");
  const spanne = s.spanne[k] === null ? "" :
    `<div class="grau">Spanne zwischen den Fonds: ${zahl2.format(s.spanne[k]).replace("+", "")} Prozentpunkte${s.uneinig[k] ? " – deutlich" : ""}</div>`;
  const abstand = (s.werte[k] !== null && region.gesamtmarkt.werte[k] !== null && region.gesamtmarkt.werte[k] !== undefined)
    ? `<div class="grau">Abstand zum Gesamtmarkt: ${zahl2.format(s.werte[k] - region.gesamtmarkt.werte[k])} Prozentpunkte</div>` : "";
  return `<strong>${esc(name)} · ${esc(region.name)}</strong> · ${esc(zeitraum)}
    <div class="wert">${prozent(s.werte[k], true)}</div>
    <div class="grau">Median aus ${s.anzahl[k]} von ${s.fonds.length} Fonds</div>${spanne}${abstand}
    <table>${fonds}</table>`;
}

function tippZeigen(zelle, x, y) {
  const tipp = $("tipp");
  tipp.innerHTML = tippInhalt(zelle);
  tipp.hidden = false;
  const breite = tipp.offsetWidth, hoehe = tipp.offsetHeight;
  if (x === undefined) {
    const r = zelle.getBoundingClientRect();
    x = r.right; y = r.bottom;
  }
  tipp.style.left = Math.min(x + 14, innerWidth - breite - 8) + "px";
  tipp.style.top = (y + 14 + hoehe > innerHeight ? Math.max(8, y - hoehe - 10) : y + 14) + "px";
}
const tippWeg = () => { $("tipp").hidden = true; };

document.addEventListener("mousemove", (e) => {
  const zelle = e.target.closest && e.target.closest(".zelle");
  if (zelle) tippZeigen(zelle, e.clientX, e.clientY); else tippWeg();
});
document.addEventListener("focusin", (e) => {
  if (e.target.classList && e.target.classList.contains("zelle")) tippZeigen(e.target); else tippWeg();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") tippWeg(); });

// ---------- Sortieren ----------
$("karten").addEventListener("click", (e) => {
  const knopf = e.target.closest("button[data-sort]");
  if (!knopf) return;
  const k = knopf.dataset.sort || null;
  if (!k) { zustand.sortierung = null; zustand.richtung = -1; }
  else if (zustand.sortierung === k) zustand.richtung *= -1;
  else { zustand.sortierung = k; zustand.richtung = -1; }
  if (k) zustand.aktienZeitraum = k;  // die Aktienrangliste folgt der sortierten Spalte
  zeichnen();
  const neu = document.querySelector(`button[data-sort="${k || ""}"]`);
  if (neu) neu.focus();
});

// ---------- Laden und Aktualisieren ----------
function meldung(text, fehler) {
  const m = $("meldung");
  m.textContent = text;
  m.classList.toggle("fehler", !!fehler);
}

// Die gespeicherte Datei (aus export.py) fragt das Programm am Rechner direkt an.
// Die öffentliche Seite (Modus „web“) wird in der Cloud nach Zeitplan neu gebaut; dort lädt der
// Knopf einfach die neueste Fassung.
const WEB = window.SEKTOR_MODUS === "web";
const SERVER = window.SEKTOR_STAND && !WEB ? "http://127.0.0.1:8771" : "";

// ---------- Ladebalken ----------
let ladeTakt = null;

function balkenZeigen(anteil, text) {
  const prozentwert = Math.round(anteil * 100);
  $("ladebalken").hidden = false;
  $("ladebalken-fuellung").style.width = prozentwert + "%";
  $("ladebalken-spur").setAttribute("aria-valuenow", String(prozentwert));
  $("ladebalken-text").textContent = text;
}

function restzeit(beginn, anteil) {
  if (!beginn || anteil < 0.08) return "";
  const vergangen = (Date.now() - new Date(beginn).getTime()) / 1000;
  const rest = Math.max(0, Math.round(vergangen * (1 - anteil) / anteil));
  return rest < 5 ? " · gleich fertig" : ` · noch etwa ${rest} Sekunden`;
}

function balkenStarten() {
  balkenZeigen(0, "Aktualisieren beginnt …");
  ladeTakt = setInterval(async () => {
    try {
      const f = await (await fetch(SERVER + "/api/fortschritt")).json();
      if (f.aktiv) balkenZeigen(f.anteil, `${f.schritt} – ${Math.round(f.anteil * 100)} %${restzeit(f.beginn, f.anteil)}`);
    } catch (e) { /* einzelne verpasste Abfrage ist egal */ }
  }, 500);
}

function balkenBeenden(erfolg) {
  clearInterval(ladeTakt);
  ladeTakt = null;
  if (erfolg) {
    balkenZeigen(1, "Fertig – 100 %");
    setTimeout(() => { $("ladebalken").hidden = true; }, 1500);
  } else {
    $("ladebalken").hidden = true;
  }
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
  meldung("");
  balkenStarten();
  let erfolg = false;
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
    zustand.stand = daten;
    zeichnen();
    erfolg = true;
    meldung("Aktualisiert.");
    setTimeout(() => meldung(""), 4000);
  } catch (fehler) {
    meldung("Aktualisieren fehlgeschlagen: " + fehler.message + (zustand.stand ? " – angezeigt ist der letzte Stand." : ""), true);
  } finally {
    balkenBeenden(erfolg);
    knopf.disabled = false;
  }
}

async function start() {
  $("aktualisieren").addEventListener("click", aktualisieren);
  if (window.SEKTOR_STAND) {  // gespeicherte HTML-Datei aus export.py: Stand steckt in der Seite
    zustand.stand = window.SEKTOR_STAND;
    zeichnen();
    if (WEB) meldung("Kurse werden an Börsentagen stündlich neu geholt.");
    return;
  }
  try {
    const daten = await (await fetch("/api/heatmap")).json();
    if (daten.leer) { $("stand").textContent = "Noch kein Stand vorhanden."; return aktualisieren(); }
    zustand.stand = daten;
    zeichnen();
  } catch (fehler) {
    meldung("Server nicht erreichbar: " + fehler.message, true);
  }
}
start();
