#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GEONAMES_URL = process.env.GEONAMES_IT_URL || "https://download.geonames.org/export/dump/IT.zip";
const outputPath = process.argv[2] || "data/localita.json";
const tmp = mkdtempSync(join(tmpdir(), "geonames-it-"));
const LOCALITA_FEATURE_CODES = new Set(["PPL", "PPLF", "PPLL", "PPLR", "PPLS", "PPLX"]);
const EXCLUDED_NAME_PATTERN = /\b(?:diocese|diocesi|roman catholic|catholic diocese)\b/i;

const normalize = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f -']/g, "")
  .toLowerCase();

try {
  const zipPath = join(tmp, "IT.zip");
  execFileSync("curl", ["-fsSL", "--max-time", "60", GEONAMES_URL, "-o", zipPath], { stdio: "inherit" });
  execFileSync("unzip", ["-q", zipPath, "-d", tmp], { stdio: "inherit" });

  const comuni = JSON.parse(readFileSync("data/comuni.json", "utf8"));
  const comuniByCode = new Map(comuni.map((comune) => [comune.codice, comune]));

  const rows = readFileSync(join(tmp, "IT.txt"), "utf8").split(/\r?\n/);
  const seen = new Set();
  const localita = [];

  for (const row of rows) {
    if (!row.trim()) continue;

    const cols = row.split("\t");
    const [geonameId, name, asciiName, alternateNames, lat, lng, featureClass, featureCode, countryCode, cc2, admin1, admin2, admin3, admin4, population, elevation, dem, timezone, modificationDate] = cols;

    if (countryCode !== "IT" || featureClass !== "P" || !LOCALITA_FEATURE_CODES.has(featureCode)) continue;

    const comune = comuniByCode.get(admin3);
    if (!comune) continue;

    const localitaName = (name || asciiName || "").trim();
    if (!localitaName) continue;
    if (localitaName.startsWith("(") || EXCLUDED_NAME_PATTERN.test(localitaName)) continue;

    // The GeoNames IT dump also contains municipality seats. Keep only actual
    // sub-municipal locality candidates, not the comune itself.
    if (normalize(localitaName) === normalize(comune.nome)) continue;
    if (comune.nomeStraniero && normalize(localitaName) === normalize(comune.nomeStraniero)) continue;

    const key = `${normalize(localitaName)}:${comune.codice}`;
    if (seen.has(key)) continue;
    seen.add(key);

    localita.push({
      geonameId: Number(geonameId),
      nome: localitaName,
      nomeAscii: asciiName || localitaName,
      tipo: "localita",
      source: "geonames",
      featureClass,
      featureCode,
      codiceComune: comune.codice,
      nomeComune: comune.nome,
      provincia: comune.provincia,
      cap: comune.cap,
      prefisso: comune.prefisso,
      popolazione: Number(population || 0),
      coordinate: {
        lat: Number(lat),
        lng: Number(lng),
      },
      timezone,
      modificationDate,
    });
  }

  localita.sort((a, b) => a.nome.localeCompare(b.nome, "it", { sensitivity: "base" }) || a.nomeComune.localeCompare(b.nomeComune, "it", { sensitivity: "base" }));

  writeFileSync(outputPath, JSON.stringify(localita) + "\n");
  console.log(`Wrote ${localita.length} localita to ${outputPath}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
