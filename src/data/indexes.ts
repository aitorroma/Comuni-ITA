import { Comune, Localita, Provincia } from "../domain/types";
import * as comuniData from "../../data/comuni.json";
import * as provinceData from "../../data/province.json";
import * as regioniData from "../../data/regioni.json";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Dataset {
  comuni: Comune[];
  localita: Localita[];
  province: Provincia[];
  regioni: string[];
  // Indexes for efficient lookup
  comuniByCodice: Map<string, Comune>;
  comuniByProvincia: Map<string, Comune[]>;
  comuniByRegione: Map<string, Comune[]>;
  localitaByComuneCodice: Map<string, Localita[]>;
  localitaByProvincia: Map<string, Localita[]>;
  localitaByRegione: Map<string, Localita[]>;

  provinceByCodice: Map<string, Provincia>;
  provinceBySigla: Map<string, Provincia>;
  provinceByRegione: Map<string, Provincia[]>;
}

export const dataset: Dataset = {
  comuni: [],
  localita: [],
  province: [],
  regioni: [],
  comuniByCodice: new Map(),
  comuniByProvincia: new Map(),
  comuniByRegione: new Map(),
  localitaByComuneCodice: new Map(),
  localitaByProvincia: new Map(),
  localitaByRegione: new Map(),
  provinceByCodice: new Map(),
  provinceBySigla: new Map(),
  provinceByRegione: new Map(),
};

function loadLocalitaData(): Localita[] {
  const path = join(__dirname, "..", "..", "data", "localita.json");

  if (!existsSync(path)) {
    console.warn("Localita dataset not found, continuing with comuni only", { path });
    return [];
  }

  return JSON.parse(readFileSync(path, "utf8")) as Localita[];
}

export function loadAndIndexData() {
  console.log("Loading and indexing data...");

  // Load regioni
  dataset.regioni = (regioniData as any).default as string[];

  // Load province
  dataset.province = (provinceData as any).default as Provincia[];
  dataset.province.forEach((provincia) => {
    dataset.provinceByCodice.set(provincia.codice, provincia);
    dataset.provinceBySigla.set(provincia.sigla, provincia);
    if (!dataset.provinceByRegione.has(provincia.regione)) {
      dataset.provinceByRegione.set(provincia.regione, []);
    }
    dataset.provinceByRegione.get(provincia.regione)?.push(provincia);
  });

  // Load comuni
  dataset.comuni = (comuniData as any).default as Comune[];
  dataset.comuni.forEach((comune) => {
    dataset.comuniByCodice.set(comune.codice, comune);

    if (!dataset.comuniByProvincia.has(comune.provincia.codice)) {
      dataset.comuniByProvincia.set(comune.provincia.codice, []);
    }
    dataset.comuniByProvincia.get(comune.provincia.codice)?.push(comune);

    // Assuming we can derive region from province, or it's directly available
    const associatedProvincia = dataset.provinceByCodice.get(comune.provincia.codice);
    if (associatedProvincia) {
      if (!dataset.comuniByRegione.has(associatedProvincia.regione)) {
        dataset.comuniByRegione.set(associatedProvincia.regione, []);
      }
      dataset.comuniByRegione.get(associatedProvincia.regione)?.push(comune);
    }
  });

  // Load località/frazioni. These records intentionally live alongside
  // comuni but remain marked as tipo=localita, so API consumers can preserve
  // the user-entered locality while still reading provincia.sigla for routing.
  dataset.localita = loadLocalitaData();
  dataset.localita.forEach((localita) => {
    if (!dataset.localitaByComuneCodice.has(localita.codiceComune)) {
      dataset.localitaByComuneCodice.set(localita.codiceComune, []);
    }
    dataset.localitaByComuneCodice.get(localita.codiceComune)?.push(localita);

    if (!dataset.localitaByProvincia.has(localita.provincia.codice)) {
      dataset.localitaByProvincia.set(localita.provincia.codice, []);
    }
    dataset.localitaByProvincia.get(localita.provincia.codice)?.push(localita);

    const regione = localita.provincia.regione;
    if (!dataset.localitaByRegione.has(regione)) {
      dataset.localitaByRegione.set(regione, []);
    }
    dataset.localitaByRegione.get(regione)?.push(localita);
  });

  console.log(
    `Data loaded: ${dataset.comuni.length} comuni, ${dataset.localita.length} localita, ${dataset.province.length} province, ${dataset.regioni.length} regioni`,
  );
}
