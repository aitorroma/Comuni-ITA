import { FastifyInstance, RouteShorthandOptions } from "fastify";
import { dataset } from "../../data/indexes";
import { Comune, ComuneSearchResult, ComuneSearchResultSchema } from "../../domain/types";
import { normalizeString } from "../../domain/normalization";
import { Static, Type } from "@sinclair/typebox";

// Define query string schema for validation and typing
import { CommonQuerySchema, CommonResponseSchema, applyPagination, applyProjection, applySorting } from "../query-utils";

// Define query string schema for validation and typing
const ComuniQuerySchema = Type.Object({
  codice: Type.Optional(Type.String()),
  codiceCatastale: Type.Optional(Type.String()),
  prefisso: Type.Optional(Type.String()),
  provincia: Type.Optional(Type.String()),
  regione: Type.Optional(Type.String()),
  cap: Type.Optional(Type.String()),
  q: Type.Optional(Type.String()),
  ...CommonQuerySchema,
});
type ComuniQuery = Static<typeof ComuniQuerySchema>;

const ComuniResponseSchema = CommonResponseSchema(ComuneSearchResultSchema);
type ComuniResponse = Static<typeof ComuniResponseSchema>;

const getComuniOpts: RouteShorthandOptions = {
  schema: {
    querystring: ComuniQuerySchema,
    response: {
      200: {
        type: "array",
        items: ComuneSearchResultSchema,
      },
    },
  },
};

// Define filter functions
const filterByRegione = (regione: string) => {
  const sanitizedRegione = normalizeString(regione);
  return (c: ComuneSearchResult) => {
    return normalizeString(c.provincia.regione) === sanitizedRegione;
  };
};

const filterByProvincia = (provincia: string) => {
  const sanitizedProvincia = normalizeString(provincia);
  return (c: ComuneSearchResult) => normalizeString(c.provincia.nome) === sanitizedProvincia || normalizeString(c.provincia.sigla) === sanitizedProvincia;
};

const applyFilters = (result: ComuneSearchResult[], query: ComuniQuery) => {
  const { codice, codiceCatastale, prefisso, provincia, regione, cap, q } = query;

  // Filtro per codice
  if (codice) {
    result = result.filter((c) => ("codice" in c && c.codice === codice) || ("codiceComune" in c && c.codiceComune === codice));
  }
  // Filtro per codice catastale
  if (codiceCatastale) {
    result = result.filter((c) => "codiceCatastale" in c && c.codiceCatastale === codiceCatastale);
  }
  // Filtro per prefisso telefonico
  if (prefisso) {
    result = result.filter((c) => c.prefisso === prefisso);
  }
  // Filtro per nome provincia
  if (provincia) {
    result = result.filter(filterByProvincia(provincia));
  }
  // Filtro per nome regione
  if (regione) {
    result = result.filter(filterByRegione(regione));
  }
  // Filtro per CAP
  if (cap) {
    result = result.filter((c) => c.cap === cap);
  }
  // Filtro per nome
  if (q) {
    const normalizedQ = normalizeString(q);
    result = result.filter(
      (c) =>
        normalizeString(c.nome).includes(normalizedQ) ||
        ("nomeStraniero" in c && c.nomeStraniero && normalizeString(c.nomeStraniero).includes(normalizedQ)) ||
        ("nomeAscii" in c && c.nomeAscii && normalizeString(c.nomeAscii).includes(normalizedQ)),
    );
  }

  return result;
};

const normalizedSearchNames = (item: ComuneSearchResult): string[] => {
  return [
    item.nome,
    "nomeStraniero" in item ? item.nomeStraniero : null,
    "nomeAscii" in item ? item.nomeAscii : null,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => normalizeString(value));
};

const rankSearchResult = (item: ComuneSearchResult, q: string): number => {
  const normalizedQ = normalizeString(q);
  const names = normalizedSearchNames(item);

  if (names.some((name) => name === normalizedQ)) return 0;
  if (names.some((name) => name.startsWith(normalizedQ))) return 1;
  if (names.some((name) => name.includes(normalizedQ))) return 2;

  return 3;
};

const getComuni = (comuni: ComuneSearchResult[], query: ComuniQuery): ComuniResponse => {
  // Filtering
  let result: Partial<Comune>[] = applyFilters(comuni, query);

  // Sorting
  if (query.q) {
    result = [...result].sort((a, b) => {
      const rank = rankSearchResult(a as ComuneSearchResult, query.q as string) - rankSearchResult(b as ComuneSearchResult, query.q as string);

      if (rank !== 0) return rank;

      return ((a as ComuneSearchResult).nome || "").localeCompare(((b as ComuneSearchResult).nome || ""), "it", { sensitivity: "base" });
    });
  } else {
    result = applySorting(result, query.sort);
  }

  const total = result.length;

  // Pagination
  const pageSize = query.pagesize || query.limit;
  result = applyPagination(result, query.page, pageSize);

  // Projection (field selection)
  result = applyProjection(result, query.fields);

  return {
    items: result,
    page: query.page,
    pagesize: pageSize || total,
    total: total,
  };
};

// Define route handlers
export function comuniRoutes(fastify: FastifyInstance) {
  // GET /comuni
  fastify.get<{ Querystring: ComuniQuery; Reply: ComuniResponse }>("/comuni", getComuniOpts, (request, reply) => {
    const comuni: ComuneSearchResult[] = [...Array.from(dataset.comuniByCodice.values()), ...dataset.localita];
    reply.send(getComuni(comuni, request.query));
  });

  // GET /comuni/:regione
  const comuniByRegioneSchema = {
    schema: {
      params: Type.Object({
        regione: Type.String(),
      }),
      querystring: ComuniQuerySchema,
      response: getComuniOpts.schema?.response,
    },
  };
  fastify.get<{ Params: { regione: string }; Querystring: ComuniQuery; Reply: ComuniResponse }>("/comuni/:regione", comuniByRegioneSchema, (request, reply) => {
    const comuni: ComuneSearchResult[] = [...dataset.comuni, ...dataset.localita].filter(filterByRegione(request.params.regione));
    reply.send(getComuni(comuni, request.query));
  });

  // GET /comuni/provincia/:provincia
  const comuniByProvinciaSchema = {
    schema: {
      params: Type.Object({
        provincia: Type.String(),
      }),
      querystring: ComuniQuerySchema,
      response: getComuniOpts.schema?.response,
    },
  };
  fastify.get<{ Params: { provincia: string }; Querystring: ComuniQuery; Reply: ComuniResponse }>("/comuni/provincia/:provincia", comuniByProvinciaSchema, (request, reply) => {
    const comuni: ComuneSearchResult[] = [...dataset.comuni, ...dataset.localita].filter(filterByProvincia(request.params.provincia));
    reply.send(getComuni(comuni, request.query));
  });
}
