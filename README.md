# Sektor-Heatmap

Kursentwicklung der elf Sektoren in Europa und den USA über sieben Zeiträume (1 Tag bis 1 Jahr,
seit Jahresbeginn), dazu Branchen und Themen, die besten Aktien der vier stärksten Sektoren und
die Top 30 je Index – als eine Seite, die auch am Handy läuft.

- Jeder Sektorwert ist der Median aus mehreren Indexfonds verschiedener Anbieter (`fonds.json`).
- Aktien: S&P 500 und S&P 400 (USA) sowie 14 europäische Landesindizes; Mitgliederlisten von
  Wikipedia, Kurse von Yahoo über `yfinance`, inklusive Ausschüttungen.
- Die Seite wird an Börsentagen stündlich neu gebaut (`.github/workflows/aktualisieren.yml`).

Vergangene Kursentwicklung, keine Anlageempfehlung. Kursdaten ohne Gewähr.
