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
  zuflussZeichnen();
  momentumZeichnen();
  aktienZeichnen();
  topZeichnen();
  $("grundlage").innerHTML = grundlage(stand) + aktienGrundlage(stand);
  $("stand").textContent = "Abgerufen am " + uhrzeit(stand.abgerufen) + " · " +
    stand.regionen.map((r) => `${r.name}: Schlusskurse vom ${datum(r.stand)}`).join(" · ");
}

// ---------- Geldzufluss und Aktien vor dem Ausbruch (Regeln und Rechnung in zufluss.py) ----------
const ZUFLUSS_ZEITRAEUME = [["quartal", "3 Monate"], ["halbjahr", "6 Monate"], ["jahr", "12 Monate"]];
const ZUFLUSS_GRUPPEN = 12;  // so viele Gruppen offen, der Rest eingeklappt
const EINSTUFUNG_TEXT = { stark: "Zufluss stark", zufluss: "Zufluss", neutral: "Neutral", abfluss: "Abfluss" };
// Rückblick-Test vom 03.11.2026, Juli 2020 bis November 2026 (Bericht in DeepWork_V1\Sektor-Heatmap\Rueckblick)
const ZUFLUSS_TEST = {
  europa: "Rückblick-Test Europa: 460 Signale, zwei Drittel stiegen innerhalb von 4 Wochen über die Marke, "
    + "nach 6 Monaten im Mittel 3,7 Prozent besser als der Gesamtmarkt, 56 Prozent schlugen ihn.",
  usa: "Rückblick-Test USA: 660 Signale, knapp zwei Drittel stiegen innerhalb von 4 Wochen über die Marke, "
    + "nach 6 Monaten im Mittel aber nicht besser als der Gesamtmarkt.",
};
const punkteText = (v) => (v === null || v === undefined) ? "–" : zahl.format(v) + " Prozentpunkte";

function zuflussMarke(einstufung) {
  const klasse = { stark: " erfuellt", zufluss: " beobachten", abfluss: " warnung" }[einstufung] || "";
  return `<span class="marke${klasse}">${EINSTUFUNG_TEXT[einstufung]}</span>`;
}

function vorAusbruchMarken(a) {
  const v = a.vor_ausbruch;
  const marken = [`<span class="marke erfuellt">Vor dem Ausbruch</span>`,
    `<span class="marke" title="Einstufung der Branche ${esc(a.branche)}">Branche: ${EINSTUFUNG_TEXT[a.gruppe]}</span>`,
    `<span class="marke" title="Höchster Schlusskurs der Basis, seit ${datum(v.seit)}">${zahl.format(v.abstand).replace("+", "")} % unter der Marke ${zahl2.format(v.marke).replace("+", "")}</span>`];
  if (v.ruhe) marken.push(`<span class="marke beobachten" title="Spanne der letzten 10 Handelstage ${zahl.format(v.spanne).replace("+", "")} %, höchstens halb so groß wie die Tiefe der Basis">Ruhe vor dem Ausbruch</span>`);
  if (v.trocken) marken.push(`<span class="marke beobachten" title="Volumen der letzten 10 Handelstage bei ${v.volumen_anteil} % der 50 Tage davor">Volumen trocknet aus</span>`);
  return marken.join("");
}

function zuflussKarte(region, stand) {
  const z = stand.zufluss[region.schluessel];
  if (!z) return `<section class="karte"><h2>${esc(region.name)}</h2><p class="grau">Keine Angaben.</p></section>`;
  const gezeigt = z.gruppen.filter((g) => g.einstufung === "stark" || g.einstufung === "zufluss");
  const abfluss = z.gruppen.filter((g) => g.einstufung === "abfluss");
  const max = Math.max(5, ...gezeigt.flatMap((g) => ZUFLUSS_ZEITRAEUME.map(([k]) => Math.abs(g.mehr[k]))));
  const zelle = (v) => `<td class="zelle aktie" style="background:${farbe(v, max)}">${zahl.format(v)}</td>`;
  const kennzahl = (text) => `<td class="zelle aktie kennzahl">${text}</td>`;
  const gruppeZeile = (g) => `<tr class="${g.einstufung === "stark" ? "einstufung-erfuellt" : ""}">
      <td class="name">${esc(g.name)}<small>${g.art} · ${g.anzahl} Aktien</small></td>
      <td class="muster">${zuflussMarke(g.einstufung)}</td>
      ${ZUFLUSS_ZEITRAEUME.map(([k]) => zelle(g.mehr[k])).join("")}
      ${kennzahl(zahl.format(g.richtung))}
      ${kennzahl(g.breite + " %")}
      ${kennzahl(g.volumen === null ? "–" : zahl2.format(g.volumen).replace("+", "") + "-fach")}</tr>`;
  const kopf = `<thead><tr><th scope="col">Sektor oder Branche</th><th scope="col" class="muster">Einstufung</th>
          ${ZUFLUSS_ZEITRAEUME.map(([, n]) => `<th scope="col" title="Entwicklung der Gruppe minus Entwicklung des Gesamtmarkts">${n}</th>`).join("")}
          <th scope="col" title="Veränderung der relativen Stärke gegenüber dem Gesamtmarkt in den letzten 30 Handelstagen, in Prozent">Richtung 6 Wochen</th>
          <th scope="col" title="Anteil der Aktien der Gruppe über ihrem 50-Tage-Durchschnitt">Breite</th>
          <th scope="col" title="Median der Aktien: Volumen an Plustagen geteilt durch Volumen an Minustagen, letzte 50 Handelstage">Volumen Plus- zu Minustagen</th></tr></thead>`;
  const tabelle = (liste) => `<div class="tabelle-rahmen"><table class="aktien-tabelle momentum-tabelle zufluss-tabelle">
        ${kopf}<tbody>${liste.map(gruppeZeile).join("")}</tbody></table></div>`;
  const weitere = gezeigt.slice(ZUFLUSS_GRUPPEN);

  const aktienZeilen = z.aktien.map((a, i) => {
    const v = a.vor_ausbruch;
    return `<tr class="${a.gruppe === "stark" ? "einstufung-erfuellt" : "einstufung-beobachten"}">
      <td class="rang">${i + 1}</td>
      <td class="name" title="${esc(a.name)} · ${esc(a.ticker)}">${esc(a.name)}
        <small>${esc(a.ticker)} · ${esc(a.branche)} · ${esc((a.indizes || [a.index]).join(", "))}</small></td>
      <td class="muster">${zuflussMarke(a.gruppe)}${v.ruhe ? '<span class="marke beobachten">Ruhe</span>' : ""}${v.trocken ? '<span class="marke beobachten">Volumen trocknet aus</span>' : ""}</td>
      ${kennzahl(zahl.format(v.abstand).replace("+", "") + " %")}
      ${kennzahl(`${v.wochen} Wochen, ${zahl.format(v.tiefe).replace("+", "")} % tief`)}
      ${kennzahl(v.rs_abstand === 0 ? "am Hoch" : zahl.format(v.rs_abstand).replace("+", "") + " % darunter")}
      ${kennzahl(v.volumen_anteil === null ? "–" : v.volumen_anteil + " %")}</tr>`;
  }).join("");

  return `<section class="karte">
    <h2>${esc(region.name)}</h2>
    <div class="aktien-block">
      <h3>Sektoren und Branchen mit Zufluss <span class="sektorwert">${gezeigt.length} von ${z.gruppen.length} Gruppen ·
        Mehrrendite gegenüber dem Gesamtmarkt in Prozentpunkten</span></h3>
      ${gezeigt.length ? tabelle(gezeigt.slice(0, ZUFLUSS_GRUPPEN)) : '<p class="grau">Keine Gruppe zeigt derzeit Zufluss.</p>'}
      ${weitere.length ? `<details class="weitere"><summary>Weitere ${weitere.length} Gruppen mit Zufluss</summary>
        ${tabelle(weitere)}</details>` : ""}
      ${abfluss.length ? `<p class="grau abfluss">Abfluss: ${abfluss.map((g) => esc(g.name)).join(", ")}</p>` : ""}
    </div>
    <div class="aktien-block">
      <h3>Aktien vor dem Ausbruch <span class="sektorwert">${z.kandidaten} von ${z.geprueft} Aktien${z.kandidaten > z.aktien.length ? `, die ersten ${z.aktien.length}` : ""}</span></h3>
      ${z.aktien.length ? `<div class="tabelle-rahmen"><table class="aktien-tabelle momentum-tabelle zufluss-aktien">
        <thead><tr><th scope="col" class="rang">Platz</th><th scope="col">Aktie</th><th scope="col" class="muster">Branche und Zusatzmarken</th>
          <th scope="col" title="Abstand des Schlusskurses zum Hoch der Basis (gestrichelte Linie im Chart)">Unter der Marke</th>
          <th scope="col" title="Dauer seit dem Hoch und größter Rückgang darunter">Basis</th>
          <th scope="col" title="Abstand der Linie Aktie geteilt durch Gesamtmarkt zu ihrem Jahreshoch">Relative Stärke zum Jahreshoch</th>
          <th scope="col" title="Volumen der letzten 10 Handelstage im Verhältnis zu den 50 Tagen davor">Volumen letzte 10 Tage</th></tr></thead>
        <tbody>${aktienZeilen}</tbody></table></div>` : '<p class="grau">Heute erfüllt keine Aktie in einer Branche mit Zufluss die Regeln.</p>'}
      <p class="grau test-hinweis">${ZUFLUSS_TEST[region.schluessel] || ""}</p>
    </div>
    ${z.aktien.length ? `<div class="aktien-block">
      <h3>Charts der ${z.aktien.length} Aktien <span class="sektorwert">ein Jahr, Tageskerzen · blaue Linie:
        50-Tage-Durchschnitt · weiße Linie: 150-Tage-Durchschnitt · gestrichelt: Marke, das Hoch der Basis ·
        unten: Handelsvolumen</span></h3>
      <div class="charts">${z.aktien.map((a, i) => chartKarte(a, i, stand, vorAusbruchMarken(a),
        a.gruppe === "stark" ? "erfuellt" : "", "zufluss")).join("")}</div>
    </div>` : ""}
  </section>`;
}

function zuflussZeichnen() {
  const stand = zustand.stand;
  if (!stand.zufluss) {
    $("zufluss-hinweis").textContent = "Für diesen Stand fehlt die Auswertung des Geldzuflusses – bitte „Aktualisieren“ drücken.";
    $("zufluss").innerHTML = "";
    $("zufluss-regeln").innerHTML = "";
    return;
  }
  const r = stand.zufluss.regeln;
  $("zufluss-hinweis").textContent = "Wo großes Geld hineinfließt, lässt sich nicht nachweisen, aber an Kursen und Volumen "
    + "sichtbar machen: Sektoren und Branchen, die über 3, 6 und 12 Monate besser laufen als der Gesamtmarkt, bei denen "
    + "der Vorsprung weiter wächst, viele Aktien mitziehen und an Plustagen mehr gehandelt wird als an Minustagen. "
    + "Darunter die Aktien aus Branchen mit Zufluss, die kurz unter dem Hoch einer Basis stehen und deren relative "
    + "Stärke schon führt. Eine Auswahl nach festen Regeln, keine Kaufempfehlung.";
  $("zufluss").innerHTML = stand.regionen.map((reg) => zuflussKarte(reg, stand)).join("");
  $("zufluss-regeln").innerHTML = `
    <p><strong>Gruppen.</strong> Je Region die elf Sektoren und die Branchen nach Yahoo mit mindestens
    ${r.mindest_mitglieder} Aktien aus den Indizes, jeweils gleich gewichtet aus den Kursen der Aktien selbst
    (nicht aus den Indexfonds der Heatmap oben). Gemessen werden vier Spuren:</p>
    <ol>
      <li><strong>Vorsprung:</strong> Entwicklung der Gruppe minus Entwicklung des Gesamtmarkts über 3, 6 und 12 Monate.</li>
      <li><strong>Richtung:</strong> ob der Vorsprung in den letzten ${r.richtung_tage} Handelstagen (rund 6 Wochen) weiter wächst.</li>
      <li><strong>Breite:</strong> Anteil der Aktien der Gruppe über ihrem 50-Tage-Durchschnitt.</li>
      <li><strong>Volumen:</strong> je Aktie das Volumen an Plustagen geteilt durch das an Minustagen über 50 Handelstage, davon der Median.</li>
    </ol>
    <p><strong>Zufluss stark:</strong> in allen drei Zeiträumen vor dem Markt, Vorsprung wächst, Breite mindestens
    ${r.breite_stark} Prozent, Volumen mindestens ${zahl2.format(r.volumen_stark).replace("+", "")}-fach.
    <strong>Zufluss:</strong> in mindestens zwei der drei Zeiträume vor dem Markt, Vorsprung wächst.
    <strong>Abfluss:</strong> in mindestens zwei Zeiträumen hinter dem Markt, Vorsprung schrumpft.</p>
    <p><strong>Aktien vor dem Ausbruch</strong> – nur aus Branchen mit Zufluss, alle drei Regeln müssen halten:</p>
    <ol>
      <li><strong>Aufwärtsphase:</strong> Kurs über dem 50- und dem 150-Tage-Durchschnitt, der 150-Tage-Durchschnitt steigt.</li>
      <li><strong>Basis:</strong> Der höchste Schlusskurs der letzten 6 Monate (die Marke) liegt mindestens
      ${r.basis_wochen} Wochen zurück, der Kurs fiel darunter höchstens ${r.basis_tiefe} Prozent und steht jetzt
      0 bis ${r.unter_hoch} Prozent unter der Marke.</li>
      <li><strong>Relative Stärke führt:</strong> Die Linie Aktie geteilt durch Gesamtmarkt steht höchstens
      ${r.rs_naehe} Prozent unter ihrem Jahreshoch, obwohl der Kurs selbst noch unter seinem Hoch liegt – das
      bekannteste Zeichen, dass jemand still einsammelt.</li>
    </ol>
    <p><strong>Zusatzmarken</strong> (nicht verlangt, nur angezeigt): <em>Ruhe vor dem Ausbruch</em> – die Spanne der
    letzten 10 Handelstage ist höchstens halb so groß wie die Tiefe der Basis. <em>Volumen trocknet aus</em> – in
    den letzten 10 Handelstagen weniger als ${r.volumen_trocken} Prozent des Volumens der 50 Tage davor, und in der
    Basis mehr Volumen an Plus- als an Minustagen.</p>
    <p><strong>Reihenfolge:</strong> erst Branchen mit starkem Zufluss, dann mehr Zusatzmarken, dann am nächsten an der Marke.</p>
    <p><strong>Rückblick-Test</strong> (Juli 2020 bis November 2026, jede Woche, gemessen nur der Einstieg):
    ${ZUFLUSS_TEST.europa} ${ZUFLUSS_TEST.usa} Die Einstufung „Zufluss“ allein trennt kaum: Aktien aus diesen Branchen
    lagen nach 6 Monaten in Europa im Mittel 2,3, in den USA 1,7 Prozentpunkte vor dem Markt, im Median aber kaum.
    Getestet wurden nur die heutigen Indexmitglieder; die Zahlen fallen dadurch eher zu gut aus.</p>
    <p><strong>Was nicht einfließt:</strong> echte Fondsflüsse (liefert Yahoo nicht), Bewertung, Quartalszahlen,
    Nachrichten. Die Liste ist ein Startpunkt für eigene Prüfung, keine Anlageberatung.</p>`;
}

// ---------- Momentum (Regeln und Rechnung in momentum.py) ----------
const MOMENTUM_ZEITRAEUME = [["monat", "1 Monat"], ["quartal", "3 Monate"], ["halbjahr", "6 Monate"], ["jahr", "1 Jahr"]];

function momentumKarte(region, stand, max, aktienMax) {
  const m = stand.momentum[region.schluessel];
  const zelle = (v, skala) => `<td class="zelle aktie${v === null || v === undefined ? " leer" : ""}"
    style="background:${farbe(v, skala)}">${prozent(v)}</td>`;
  const kennzahl = (text) => `<td class="zelle aktie kennzahl">${text}</td>`;
  const punkte = (v) => `<td class="zelle aktie gesamt-wert">${Math.round(v)}</td>`;

  const bereichZeilen = m.bereiche.map((b, i) => `<tr>
      <td class="rang">${i + 1}</td>
      <td class="name">${esc(b.name)}<small>${b.gruppe === "sektoren" ? "Sektor" : "Branche oder Thema"}</small></td>
      ${MOMENTUM_ZEITRAEUME.map(([k]) => zelle(b.werte[k], max[k])).join("")}
      ${punkte(b.punkte)}</tr>`).join("");

  const aktienZeilen = m.aktien.map((a, i) => {
    const t = a.trend;
    const indizes = (a.indizes || [a.index]).join(", ");
    return `<tr class="${a.muster.einstufung ? "einstufung-" + a.muster.einstufung : ""}">
      <td class="rang">${i + 1}</td>
      <td class="name" title="${esc(a.name)} · ${esc(a.ticker)} · ${esc(indizes)}">${esc(a.name)}
        <small>${esc(a.ticker)} · ${esc(a.sektor)} · ${esc(indizes)}</small></td>
      <td class="muster">${musterMarken(a.muster)}</td>
      ${zelle(t.zwoelf_ohne_letzten, aktienMax.jahr)}
      ${zelle(t.sechs_ohne_letzten, aktienMax.halbjahr)}
      ${zelle(a.werte.monat, aktienMax.monat)}
      ${kennzahl(zahl.format(t.schwankung).replace("+", "") + " %")}
      ${kennzahl(t.abstand_hoch === 0 ? "am Hoch" : prozent(t.abstand_hoch))}
      ${punkte(a.punkte)}</tr>`;
  }).join("");

  const aktienTeil = !stand.aktien ? '<p class="grau">Für diesen Stand liegen noch keine Aktienkurse vor.</p>'
    : !m.aktien.length ? '<p class="grau">Keine Aktie erfüllt alle Filter. Fehlen dem Stand die Trendkennzahlen, '
      + 'hilft „Aktualisieren“.</p>'
    : `<div class="tabelle-rahmen"><table class="aktien-tabelle momentum-tabelle momentum-aktien">
        <thead><tr><th scope="col" class="rang">Platz</th><th scope="col">Aktie</th>
          <th scope="col" class="muster">Phase und Muster</th>
          <th scope="col" title="Kursgewinn vom Stand vor zwölf Monaten bis vor einem Monat">12 Monate ohne den letzten</th>
          <th scope="col" title="Kursgewinn vom Stand vor sechs Monaten bis vor einem Monat">6 Monate ohne den letzten</th>
          <th scope="col">Letzter Monat</th>
          <th scope="col" title="Schwankung der Tageskurse über ein Jahr, auf ein Jahr hochgerechnet">Schwankung pro Jahr</th>
          <th scope="col" title="Abstand zum höchsten Kurs der letzten 52 Wochen">Abstand zum Hoch</th>
          <th scope="col" title="Besser als so viel Prozent der zugelassenen Aktien">Momentum-Wert</th></tr></thead>
        <tbody>${aktienZeilen}</tbody></table></div>`;

  return `<section class="karte">
    <h2>${esc(region.name)}</h2>
    <div class="aktien-block">
      <h3>Top ${m.bereiche.length} Bereiche <span class="sektorwert">Sektoren, Branchen und Themen</span></h3>
      <div class="tabelle-rahmen"><table class="aktien-tabelle momentum-tabelle">
        <thead><tr><th scope="col" class="rang">Platz</th><th scope="col">Bereich</th>
          ${MOMENTUM_ZEITRAEUME.map(([, n]) => `<th scope="col">${n}</th>`).join("")}
          <th scope="col" title="Besser als so viel Prozent der Bereiche dieser Region">Momentum-Wert</th></tr></thead>
        <tbody>${bereichZeilen}</tbody></table></div>
    </div>
    <div class="aktien-block">
      <h3>Top ${stand.momentum.regeln.anzahl_aktien} Aktien aus ${esc(m.sektoren.join(", "))}
        <span class="sektorwert">${m.zugelassen} von ${m.geprueft} Aktien dieser Sektoren erfüllen alle Filter</span></h3>
      ${aktienTeil}
    </div>
    ${m.aktien.length ? `<div class="aktien-block">
      <h3>Charts der ${m.aktien.length} Aktien <span class="sektorwert">ein Jahr, Tageskerzen · blaue Linie:
        50-Tage-Durchschnitt · weiße Linie: 150-Tage-Durchschnitt · gestrichelt: Ausbruchsmarke · gelber Pfeil:
        Ausbruchstag · unten: Handelsvolumen</span></h3>
      <div class="charts">${m.aktien.map((a, i) => chartKarte(a, i, stand)).join("")}</div>
    </div>` : ""}
  </section>`;
}

// ---------- Phase, Ausbruch und Kurschart (Regeln in muster.py) ----------
const tagMonat = (iso) => { const [, m, t] = iso.split("-"); return `${+t}.${+m}.`; };

function musterMarken(mu) {
  if (!mu) return '<span class="marke">keine Angaben</span>';
  const marken = [];
  if (mu.einstufung === "erfuellt") marken.push('<span class="marke erfuellt">Alle Regeln erfüllt</span>');
  if (mu.einstufung === "beobachten") marken.push('<span class="marke beobachten">Beobachten</span>');
  marken.push(`<span class="marke" title="Phase nach Weinstein, gemessen am 150-Tage-Durchschnitt">Phase ${mu.phase}: ${esc(mu.phase_name)}</span>`);
  const a = mu.ausbruch;
  if (a) {
    const basis = `Bodenbildung über ${a.wochen} Wochen, Marke ${zahl2.format(a.marke).replace("+", "")}, Rücksetzer ${zahl.format(a.tiefe).replace("+", "")} %`;
    const text = {  // als Funktionen, weil nur ein Ausbruch ein Datum hat
      ausbruch: () => `Ausbruch am ${tagMonat(a.tag)} mit ${zahl.format(a.volumen_faktor).replace("+", "")}-fachem Volumen`,
      ausbruch_leise: () => `Ausbruch am ${tagMonat(a.tag)} ohne erhöhtes Volumen` +
        (a.volumen_faktor ? ` (${zahl.format(a.volumen_faktor).replace("+", "")}-fach)` : ""),
      gescheitert: () => `Ausbruch am ${tagMonat(a.tag)} gescheitert`,
      an_der_marke: () => `${zahl.format(Math.abs(a.abstand)).replace("+", "")} % unter der Ausbruchsmarke`,
    }[a.art]();
    marken.push(`<span class="marke${a.art === "gescheitert" ? " warnung" : ""}" title="${esc(basis)}">${text}</span>`);
  }
  if (mu.warnung !== null) marken.push(`<span class="marke warnung" title="Größter Wochenverlust des letzten halben Jahres, in den letzten zwei Wochen – oft das erste Zeichen einer Topbildung">Warnzeichen: Wochenverlust ${zahl.format(mu.warnung)} %</span>`);
  if (mu.weit_gelaufen) marken.push(`<span class="marke warnung" title="Kurs weit über dem 50-Tage-Durchschnitt – ein Rücksetzer ist wahrscheinlich">${zahl.format(mu.ueber_50)} % über dem 50-Tage-Durchschnitt</span>`);
  return marken.join("");
}

function chartKarte(a, i, stand, marken = musterMarken(a.muster), einstufung = a.muster.einstufung, liste = "momentum") {
  const daten = stand.charts && stand.charts[a.ticker];
  return `<figure class="chart${einstufung ? " einstufung-" + einstufung : ""}">
    <figcaption><span class="platz">${i + 1}.</span> ${esc(a.name)} <small>${esc(a.ticker)}</small></figcaption>
    <div class="chart-marken">${marken}</div>
    ${daten ? `<canvas data-ticker="${esc(a.ticker)}" data-liste="${liste}" aria-label="Kurschart ${esc(a.name)} über ein Jahr"></canvas>
      <p class="chart-ablesen grau" data-ablesen="${esc(a.ticker)}">Zeiger auf den Chart: Kurs und Volumen des Tages</p>`
      : '<p class="grau">Chart beim nächsten Aktualisieren.</p>'}
    <div class="kauf-zeile">
      <button type="button" class="kaufen" data-kaufen="${esc(a.ticker)}"
        title="Merkt sich Kurs und Zeitpunkt – es geht kein Auftrag an eine Börse">Kaufen</button>
      <span class="kauf-stand" data-kauf-stand="${esc(a.ticker)}"></span>
    </div>
  </figure>`;
}

function kursChart(leinwand, d, mu) {
  const stil = getComputedStyle(document.documentElement);
  const wert = (name) => stil.getPropertyValue(name).trim();
  const gewinn = `rgb(${wert("--gewinn")})`, verlust = `rgb(${wert("--verlust")})`;
  const verh = window.devicePixelRatio || 1;
  const breite = leinwand.clientWidth, hoehe = leinwand.clientHeight;
  if (!breite) return;
  leinwand.width = breite * verh; leinwand.height = hoehe * verh;
  const g = leinwand.getContext("2d");
  g.scale(verh, verh);
  g.font = `11px ${wert("--schrift")}`;

  const n = d.c.length, rechts = 52, unten = 16, oben = 6;
  const volHoehe = (hoehe - unten - oben) * 0.18;
  const kursUnten = hoehe - unten - volHoehe - 8;
  const a = mu && mu.ausbruch;
  const alle = [...d.h, ...d.l, ...d.d50, ...d.d150, a ? a.marke : null].filter((v) => v !== null);
  let min = Math.min(...alle), max = Math.max(...alle);
  const rand = (max - min) * 0.05; min -= rand; max += rand;
  const schritt = (breite - rechts) / n;
  const x = (i) => (i + 0.5) * schritt;
  const y = (v) => oben + (max - v) / (max - min) * (kursUnten - oben);

  // Kurslinien des Rasters mit Beschriftung rechts
  g.strokeStyle = wert("--linie"); g.fillStyle = wert("--text-2"); g.lineWidth = 1; g.textBaseline = "middle";
  const preis = new Intl.NumberFormat("de-DE", { maximumSignificantDigits: 4 });
  for (let k = 0; k <= 4; k++) {
    const v = min + (max - min) * k / 4, yy = Math.round(y(v)) + 0.5;
    g.beginPath(); g.moveTo(0, yy); g.lineTo(breite - rechts, yy); g.stroke();
    g.fillText(preis.format(v), breite - rechts + 6, yy);
  }
  // Monatsnamen am ersten Handelstag jedes Quartals
  g.textBaseline = "alphabetic";
  const monate = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  let frei = 0;  // erste freie Stelle rechts vom letzten Monatsnamen
  for (let i = 1; i < n; i++) {
    const m = +d.daten[i].slice(5, 7);
    if (m !== +d.daten[i - 1].slice(5, 7) && m % 3 === 1) {
      g.beginPath(); g.moveTo(Math.round(x(i)) + 0.5, oben); g.lineTo(Math.round(x(i)) + 0.5, hoehe - unten); g.stroke();
      const name = monate[m - 1] + (m === 1 ? " " + d.daten[i].slice(0, 4) : "");
      const weite = g.measureText(name).width;
      if (x(i) + 2 >= frei && x(i) + 2 + weite <= breite - rechts) {
        g.fillText(name, x(i) + 2, hoehe - 3);
        frei = x(i) + 2 + weite + 8;
      }
    }
  }
  // Volumen unten
  const vMax = Math.max(1, ...d.v.filter((v) => v !== null));
  d.v.forEach((v, i) => {
    if (!v) return;
    g.fillStyle = (d.c[i] >= d.o[i] ? gewinn : verlust).replace("rgb", "rgba").replace(")", ", .45)");
    const h = v / vMax * volHoehe;
    g.fillRect(x(i) - Math.max(1, schritt * 0.35), hoehe - unten - h, Math.max(1, schritt * 0.7), h);
  });
  // Kerzen
  d.c.forEach((c, i) => {
    const steigt = c >= d.o[i];
    g.strokeStyle = g.fillStyle = steigt ? gewinn : verlust;
    const xx = Math.round(x(i)) + 0.5;
    g.beginPath(); g.moveTo(xx, y(d.h[i])); g.lineTo(xx, y(d.l[i])); g.stroke();
    const oben1 = y(Math.max(c, d.o[i])), hoehe1 = Math.max(1, Math.abs(y(c) - y(d.o[i])));
    g.fillRect(x(i) - Math.max(0.5, schritt * 0.3), oben1, Math.max(1, schritt * 0.6), hoehe1);
  });
  // Durchschnitte
  const linie = (reihe, farbe) => {
    g.strokeStyle = farbe; g.lineWidth = 1.5; g.beginPath();
    let an = false;
    reihe.forEach((v, i) => { if (v === null) { an = false; return; } an ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)); an = true; });
    g.stroke(); g.lineWidth = 1;
  };
  linie(d.d50, wert("--linie-50"));
  linie(d.d150, wert("--linie-150"));
  // Ausbruchsmarke ab dem Hoch der Bodenbildung, Pfeil am Ausbruchstag
  if (a) {
    const von = Math.max(0, d.daten.indexOf(a.seit));
    g.strokeStyle = wert("--text"); g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(x(von), y(a.marke)); g.lineTo(breite - rechts, y(a.marke)); g.stroke();
    g.setLineDash([]);
    const tag = a.tag ? d.daten.indexOf(a.tag) : -1;
    if (tag >= 0) {
      const spitze = y(d.l[tag]) + 6;
      g.fillStyle = wert("--pfeil");
      g.beginPath(); g.moveTo(x(tag), spitze); g.lineTo(x(tag) - 6, spitze + 10); g.lineTo(x(tag) + 6, spitze + 10); g.closePath(); g.fill();
    }
  }
}

// Aktie aus einer der beiden Listen mit Charts (Geldzufluss, Momentum) samt Region
function gezeigteAktie(ticker, liste) {
  const stand = zustand.stand;
  for (const r of stand.regionen) {
    const vor = liste !== "momentum" && stand.zufluss && stand.zufluss[r.schluessel];
    const a = vor && vor.aktien.find((x) => x.ticker === ticker);
    if (a) return { aktie: a, region: r, muster: { ausbruch: { marke: a.vor_ausbruch.marke, seit: a.vor_ausbruch.seit } } };
    const m = liste !== "zufluss" && stand.momentum && stand.momentum[r.schluessel];
    const b = m && m.aktien.find((x) => x.ticker === ticker);
    if (b) return { aktie: b, region: r, muster: b.muster };
  }
  return null;
}

function chartsZeichnen() {
  const stand = zustand.stand;
  if (!stand.charts) return;
  document.querySelectorAll("canvas[data-ticker]").forEach((leinwand) => {
    const t = leinwand.dataset.ticker;
    const gezeigt = gezeigteAktie(t, leinwand.dataset.liste);
    kursChart(leinwand, stand.charts[t], gezeigt && gezeigt.muster);
  });
}

// Ablesen: Datum, Schlusskurs und Volumen des Tages unter dem Zeiger
const volumenZahl = new Intl.NumberFormat("de-DE", { notation: "compact", compactDisplay: "long", maximumFractionDigits: 1 });
document.addEventListener("mousemove", (e) => {
  const leinwand = e.target.closest && e.target.closest("canvas[data-ticker]");
  if (!leinwand) return;
  const d = zustand.stand.charts[leinwand.dataset.ticker];
  const r = leinwand.getBoundingClientRect();
  const i = Math.floor((e.clientX - r.left) / ((r.width - 52) / d.c.length));
  if (i < 0 || i >= d.c.length) return;
  const zeile = document.querySelector(`[data-ablesen="${CSS.escape(leinwand.dataset.ticker)}"]`);
  const preis = new Intl.NumberFormat("de-DE", { maximumSignificantDigits: 5 });
  zeile.textContent = `${datum(d.daten[i])} · Schluss ${preis.format(d.c[i])} · Hoch ${preis.format(d.h[i])} · Tief ${preis.format(d.l[i])}`
    + (d.v[i] ? ` · Volumen ${volumenZahl.format(d.v[i])}` : "");
});
let chartTakt = null;
window.addEventListener("resize", () => { clearTimeout(chartTakt); chartTakt = setTimeout(chartsZeichnen, 150); });

function momentumZeichnen() {
  const stand = zustand.stand;
  if (!stand.momentum) {
    $("momentum-hinweis").textContent = "Für diesen Stand fehlt die Momentum-Rangliste – bitte „Aktualisieren“ drücken.";
    $("momentum").innerHTML = "";
    $("momentum-regeln").innerHTML = "";
    return;
  }
  const r = stand.momentum.regeln;
  $("momentum-hinweis").textContent = `Je Region die ${r.anzahl_bereiche} Bereiche mit dem stärksten Momentum und `
    + `die ${r.anzahl_aktien} Aktien mit dem stärksten Aufwärtstrend aus den ${r.anzahl_sektoren} führenden Sektoren. `
    + "Zuerst stehen Aktien in der Aufwärtsphase mit frischem Ausbruch über eine Bodenbildung (markiert mit „Alle Regeln erfüllt“), "
    + "dann solche kurz davor („Beobachten“), dann die übrigen. "
    + "Es zählt allein der Kursverlauf – Bewertung, Quartalszahlen, Ausblick und Nachrichten fließen nicht ein. "
    + "Eine Auswahl nach festen Regeln, keine Kaufempfehlung.";
  // Farbskala der Bereiche je Zeitraum: größter Betrag in beiden Ranglisten = volle Farbe
  const max = {};
  for (const [k] of MOMENTUM_ZEITRAEUME) {
    max[k] = Math.max(1, ...stand.regionen.flatMap((reg) =>
      stand.momentum[reg.schluessel].bereiche.map((b) => Math.abs(b.werte[k] ?? 0))));
  }
  const aktienMax = stand.aktien ? aktienSkalen(stand) : {};
  $("momentum").innerHTML = stand.regionen.map((reg) => momentumKarte(reg, stand, max, aktienMax)).join("");
  chartsZeichnen();
  kaeufeZeichnen();
  $("momentum-regeln").innerHTML = `
    <p><strong>Bereiche.</strong> Für jeden Sektor, jede Branche und jedes Thema einer Region wird je Zeitraum
    (1, 3, 6 und 12 Monate) ermittelt, besser als wie viel Prozent der übrigen Bereiche er abgeschnitten hat.
    Der Mittelwert daraus ist der Momentum-Wert (0 bis 100). Oben steht, wer über mehrere Zeiträume vorn liegt –
    ein einzelner starker Monat reicht nicht.</p>
    <p><strong>Aktien.</strong> Geprüft werden nur Aktien aus den ${r.anzahl_sektoren} Sektoren mit dem höchsten
    Momentum-Wert; Branchen und Themen bleiben dabei außen vor, weil die Aktien nur den elf Sektoren zugeordnet
    sind. Zugelassen ist eine Aktie nur, wenn alle Filter halten:</p>
    <ol>
      <li>mindestens ein Jahr Kurse vorhanden,</li>
      <li>Kurs über dem Durchschnitt der letzten 200 Handelstage (Aufwärtstrend),</li>
      <li>Durchschnitt der letzten 50 Handelstage über dem der letzten 200 (Trend bestätigt),</li>
      <li>höchstens ${r.hoechster_abstand_hoch} Prozent unter dem höchsten Kurs der letzten 52 Wochen,</li>
      <li>Phase 2, die Aufwärtsphase (siehe unten).</li>
    </ol>
    <p>Rangfolge: Kursgewinn über 12 und über 6 Monate, jeweils ohne den letzten Monat, geteilt durch die
    Schwankung. Der letzte Monat bleibt weg, weil kurzfristige Ausschläge oft wieder drehen; die Schwankung
    bevorzugt ruhige Aufwärtstrends vor wilden Sprüngen. Von beiden Kennzahlen der Rangplatz unter den
    zugelassenen Aktien, daraus der Mittelwert.</p>
    <p><strong>Phasen nach Stan Weinstein,</strong> gemessen am Durchschnitt der letzten 150 Handelstage
    (30 Wochen, weiße Linie im Chart). „Steigt“ oder „fällt“ heißt: mehr als 0,5 Prozent in 20 Handelstagen.</p>
    <ol>
      <li><strong>Bodenbildung:</strong> Durchschnitt flach nach einem Abwärtstrend, oder Kurs schon über dem fallenden Durchschnitt.</li>
      <li><strong>Aufwärtsphase:</strong> Durchschnitt steigt, Kurs darüber.</li>
      <li><strong>Topbildung:</strong> Durchschnitt flach nach einem Aufwärtstrend, oder Kurs unter den steigenden Durchschnitt gefallen.</li>
      <li><strong>Abwärtsphase:</strong> Durchschnitt fällt, Kurs darunter.</li>
    </ol>
    <p><strong>Warnzeichen:</strong> Der größte Wochenverlust des letzten halben Jahres (mehr als 5 Prozent) fiel in
    die letzten zwei Wochen – oft das erste Zeichen einer Topbildung.</p>
    <p><strong>Ausbruch über eine Bodenbildung.</strong> Die Ausbruchsmarke (gestrichelte Linie) ist der höchste
    Schlusskurs der rund sechs Monate vor den letzten zehn Handelstagen. Als Bodenbildung zählt das nur, wenn der
    Kurs danach mindestens drei Wochen darunter blieb und höchstens 35 Prozent zurückfiel. Ausbruch heißt: in den
    letzten zehn Handelstagen erstmals über der Marke geschlossen (Pfeil im Chart); „mit Volumen“, wenn an dem
    Tag mindestens das 1,4-Fache des durchschnittlichen Handelsvolumens der 50 Tage davor umgesetzt wurde.
    Fällt der Kurs danach mehr als 3 Prozent unter die Marke zurück, gilt der Ausbruch als gescheitert.</p>
    <p><strong>„Alle Regeln erfüllt“:</strong> Aufwärtsphase, Ausbruch mit Volumen, kein Warnzeichen und höchstens
    25 Prozent über dem 50-Tage-Durchschnitt (blaue Linie) – sonst ist die Aktie weit gelaufen und ein
    Rücksetzer wahrscheinlich. <strong>„Beobachten“:</strong> Aufwärtsphase, höchstens 5 Prozent unter der
    Ausbruchsmarke oder Ausbruch ohne erhöhtes Volumen, kein Warnzeichen, nicht weit gelaufen.</p>
    <p><strong>Was nicht einfließt:</strong> Bewertung (etwa Kurs-Gewinn-Verhältnis), Quartalszahlen, Ausblick,
    Nachrichten, Insiderkäufe, Dividende, Handelsvolumen und Währung. Momentum kann schnell drehen, besonders
    nach starken Läufen. Die Liste ist ein Startpunkt für eigene Prüfung, keine Anlageberatung.</p>`;
}

// ---------- Meine Käufe (nur gemerkt, kein Auftrag; am Rechner über kaeufe.py) ----------
// Läuft das Programm am Rechner, liegen die Käufe dort und die Kurse kommen frisch von Yahoo.
// Sonst (öffentliche Seite, Datei ohne Programm) merkt sich der Browser die Käufe selbst.
const KAEUFE_SCHLUESSEL = "sektor-heatmap-kaeufe";
const kaeufe = { liste: [], kurse: {}, ort: null };
const preisText = (v) => new Intl.NumberFormat("de-DE",
  { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }).format(v);

function browserKaeufe(neu) {
  try {
    if (neu) localStorage.setItem(KAEUFE_SCHLUESSEL, JSON.stringify(neu));
    return JSON.parse(localStorage.getItem(KAEUFE_SCHLUESSEL) || "[]");
  } catch {
    return neu || [];
  }
}

async function kaeufeLaden() {
  if (!WEB) {
    try {
      const antwort = await fetch(SERVER + "/api/kaeufe");
      if (antwort.ok) {
        const daten = await antwort.json();
        Object.assign(kaeufe, { liste: daten.kaeufe, kurse: daten.kurse, ort: "server" });
        return kaeufeZeichnen();
      }
    } catch { /* Programm läuft nicht: im Browser merken */ }
  }
  Object.assign(kaeufe, { liste: browserKaeufe(), kurse: {}, ort: "browser" });
  kaeufeZeichnen();
}

async function kaeufeAendern(pfad, angaben) {
  if (kaeufe.ort === "server") {
    const antwort = await fetch(SERVER + pfad, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(angaben) });
    const daten = await antwort.json();
    if (!antwort.ok) throw new Error(daten.fehler || "nicht gespeichert");
    Object.assign(kaeufe, { liste: daten.kaeufe, kurse: daten.kurse });
  } else {
    const liste = browserKaeufe();
    kaeufe.liste = browserKaeufe(pfad.endsWith("/entfernen") ? liste.filter((k) => k.id !== angaben.id)
      : liste.concat([{ ...angaben, id: Date.now().toString(36), kurs_quelle: "stand", gemerkt_am: new Date().toISOString() }]));
  }
  kaeufeZeichnen();
}

// Kurs aus dem angezeigten Stand: Aktienliste, sonst letzter Schlusskurs im Chart
function standKurs(ticker) {
  const stand = zustand.stand;
  for (const r of Object.values(stand.aktien || {})) {
    const a = r.aktien.find((x) => x.ticker === ticker);
    if (a && a.kurs) return { kurs: a.kurs, datum: a.kurs_datum };
  }
  const c = stand.charts && stand.charts[ticker];
  return c ? { kurs: c.c[c.c.length - 1], datum: c.daten[c.daten.length - 1] } : null;
}

function seitKauf(kauf) {
  const jetzt = kaeufe.kurse[kauf.ticker] || standKurs(kauf.ticker);
  return jetzt ? { ...jetzt, veraenderung: (jetzt.kurs / kauf.kurs - 1) * 100 } : null;
}

const plusMinus = (v) => `<span class="${v >= 0 ? "plus" : "minus"}">${prozent(v, true)}</span>`;

function kaeufeZeichnen() {
  if (!zustand.stand) return;
  document.querySelectorAll("[data-kauf-stand]").forEach((feld) => {
    const eigene = kaeufe.liste.filter((k) => k.ticker === feld.dataset.kaufStand);
    if (!eigene.length) { feld.textContent = ""; return; }
    const letzter = eigene[eigene.length - 1], s = seitKauf(letzter);
    feld.innerHTML = `Gekauft am ${datum(letzter.gemerkt_am.slice(0, 10))} zu ${preisText(letzter.kurs)}`
      + (s ? ` · seit Kauf ${plusMinus(s.veraenderung)}` : "") + (eigene.length > 1 ? ` · ${eigene.length} Käufe` : "");
  });

  $("kaeufe-hinweis").textContent = "Der Knopf „Kaufen“ unter den Charts merkt sich Kurs und Zeitpunkt – es geht kein "
    + "Auftrag an eine Börse. " + (kaeufe.ort === "server"
      ? "Gespeichert am Rechner; Kurs beim Kauf und aktuelle Kurse frisch von Yahoo (während der Börsenzeit laufend). "
      : "Gespeichert nur in diesem Browser; die Kurse stammen aus dem angezeigten Stand. ")
    + "Kurse in der Währung des Börsenplatzes, Veränderung ohne Ausschüttungen und Gebühren.";
  if (!kaeufe.liste.length) {
    $("kaeufe").innerHTML = '<p class="grau">Noch nichts gekauft. Der Knopf steht unter jedem Chart in den Abschnitten „Geldzufluss“ und „Momentum“.</p>';
    return;
  }
  const werte = kaeufe.liste.map(seitKauf);
  const mit = werte.filter(Boolean).map((s) => s.veraenderung);
  const max = Math.max(10, ...mit.map(Math.abs));
  const zeilen = kaeufe.liste.map((k, i) => ({ k, s: werte[i] })).reverse().map(({ k, s }) => `<tr>
      <td class="name">${esc(k.name)}<small>${esc(k.ticker)}${k.sektor ? " · " + esc(k.sektor) : ""}</small></td>
      <td>${uhrzeit(k.gemerkt_am)}</td>
      <td class="zahl">${preisText(k.kurs)}<small>Kurs vom ${datum(k.kurs_datum)}</small></td>
      <td class="zahl">${s ? preisText(s.kurs) + `<small>Kurs vom ${datum(s.datum)}</small>` : "–"}</td>
      <td class="zelle aktie" style="background:${s ? farbe(s.veraenderung, max) : ""}">${s ? prozent(s.veraenderung, true) : "–"}</td>
      <td><button type="button" class="entfernen" data-entfernen="${esc(k.id)}">Entfernen</button></td></tr>`).join("");
  const schnitt = mit.length ? mit.reduce((x, y) => x + y, 0) / mit.length : null;
  $("kaeufe").innerHTML = `<div class="tabelle-rahmen"><table class="kauf-tabelle">
    <thead><tr><th scope="col">Aktie</th><th scope="col">Gekauft am</th><th scope="col">Kaufkurs</th>
      <th scope="col">Aktueller Kurs</th><th scope="col">Seit Kauf</th><th scope="col"><span class="unsichtbar">Entfernen</span></th></tr></thead>
    <tbody>${zeilen}</tbody>
    <tfoot><tr><td colspan="4">Durchschnitt über ${kaeufe.liste.length === 1 ? "einen Kauf" : kaeufe.liste.length + " Käufe"}</td>
      <td class="zelle aktie gesamt-wert">${schnitt === null ? "–" : plusMinus(schnitt)}</td><td></td></tr></tfoot>
  </table></div>`;
}

document.addEventListener("click", async (e) => {
  const knopf = e.target.closest("button[data-kaufen]");
  if (!knopf) return;
  const ticker = knopf.dataset.kaufen;
  const { aktie, region } = gezeigteAktie(ticker);
  const kurs = standKurs(ticker);
  knopf.disabled = true;
  try {
    await kaeufeAendern("/api/kaeufe", { ticker, name: aktie.name, sektor: aktie.sektor, region: region.name,
      kurs: kurs && kurs.kurs, kurs_datum: kurs && kurs.datum });
    const neu = kaeufe.liste[kaeufe.liste.length - 1];
    meldung(`Kauf gemerkt: ${aktie.name} zu ${preisText(neu.kurs)}.`);
  } catch (fehler) {
    meldung("Kauf nicht gemerkt: " + fehler.message, true);
  } finally {
    knopf.disabled = false;
  }
});

$("kaeufe").addEventListener("click", async (e) => {
  const knopf = e.target.closest("button[data-entfernen]");
  if (!knopf) return;
  const kauf = kaeufe.liste.find((k) => k.id === knopf.dataset.entfernen);
  if (!kauf || !confirm(`Kauf von ${kauf.name} vom ${uhrzeit(kauf.gemerkt_am)} entfernen?`)) return;
  try {
    await kaeufeAendern("/api/kaeufe/entfernen", { id: kauf.id });
  } catch (fehler) {
    meldung("Nicht entfernt: " + fehler.message, true);
  }
});

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
  const zelle = e.target.closest && e.target.closest(".zelle[data-region]");
  if (zelle) tippZeigen(zelle, e.clientX, e.clientY); else tippWeg();
});
document.addEventListener("focusin", (e) => {
  if (e.target.classList && e.target.classList.contains("zelle") && e.target.dataset.region) tippZeigen(e.target); else tippWeg();
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
    kaeufeLaden();  // aktuelle Kurse für „seit Kauf“
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
    return kaeufeLaden();
  }
  try {
    const daten = await (await fetch("/api/heatmap")).json();
    if (daten.leer) { $("stand").textContent = "Noch kein Stand vorhanden."; return aktualisieren(); }
    zustand.stand = daten;
    zeichnen();
    kaeufeLaden();
  } catch (fehler) {
    meldung("Server nicht erreichbar: " + fehler.message, true);
  }
}
start();
