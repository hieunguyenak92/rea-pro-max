import { RpmError } from '../common.mjs';

const MAX_PATHS = 1_000;
const MAX_OPERATIONS = 2_000;
const MAX_ENTRIES = 5_000;
const MAX_ROUTE_CHECKS = 250_000;
const MAX_PATH_LENGTH = 1_024;
const MAX_SEGMENTS = 32;
const MAX_URL_LENGTH = 8_192;
const MAX_REPORTED_AMBIGUITY = 8;
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const METHODS_V32 = [...METHODS, 'query'];
const METHOD_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,32}$/u;
const PATH_LITERAL = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|%[\da-fA-F]{2})*$/u;

function record(value) {
  return value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function pathKey(value) {
  // Treat an encoded byte as one opaque token distinct from URI literals.
  return value.replace(/%[\da-fA-F]{2}/gu, escape => String.fromCharCode(256 + Number.parseInt(escape.slice(1), 16)));
}

function pathSegments(path) {
  if (!path.startsWith('/') || path.startsWith('//') || path.length > MAX_PATH_LENGTH) return null;
  const segments = path.slice(1).split('/');
  return segments.length <= MAX_SEGMENTS ? segments : null;
}

function ambiguousDotSegment(value) {
  const dots = value.replace(/%2e/giu, '.');
  return dots === '.' || dots === '..';
}

function compilePath(path) {
  const segments = pathSegments(path);
  if (!segments) return null;
  const names = new Set();
  const patterns = [];
  for (const segment of segments) {
    const literals = [];
    let offset = 0;
    for (const match of segment.matchAll(/\{([A-Za-z0-9_.-]{1,64})\}/gu)) {
      if (names.has(match[1])) return null;
      names.add(match[1]);
      literals.push(segment.slice(offset, match.index));
      offset = match.index + match[0].length;
    }
    literals.push(segment.slice(offset));
    if (!literals.every(literal => PATH_LITERAL.test(literal)) || ambiguousDotSegment(segment)) return null;
    patterns.push(literals.map(pathKey));
  }
  return { patterns, templated: names.size > 0 };
}

function matchSegment(literals, segment) {
  if (literals.length === 1) return literals[0] === segment;
  const prefix = literals[0];
  const suffix = literals.at(-1);
  if (!segment.startsWith(prefix) || !segment.endsWith(suffix)) return false;
  const suffixStart = segment.length - suffix.length;
  let offset = prefix.length;
  // Choose the earliest separator after each non-empty parameter. With no
  // parameter value constraints, that leaves maximal room for all later parts.
  for (let index = 1; index < literals.length - 1; index++) {
    if (offset >= suffixStart) return false;
    const separator = literals[index];
    const start = segment.indexOf(separator, offset + 1);
    if (start === -1) return false;
    offset = start + separator.length;
  }
  return offset < suffixStart;
}

function count(bucket, reason) {
  bucket[reason] = (bucket[reason] ?? 0) + 1;
}

function append(map, key, value) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function indexContract(openapi) {
  if (!record(openapi) || typeof openapi.openapi !== 'string' || !/^3\.[012]\.\d{1,3}$/u.test(openapi.openapi)) {
    throw new RpmError('api_contract_input', 'Provide an OpenAPI 3.0, 3.1 or 3.2 JSON document.');
  }
  const paths = Object.hasOwn(openapi, 'paths') ? openapi.paths : {};
  if (!record(paths)) throw new RpmError('api_contract_input', 'OpenAPI paths must be a JSON object.');
  const keys = Object.keys(paths);
  if (keys.length > MAX_PATHS) throw new RpmError('api_contract_bounds', 'OpenAPI path entries exceed the comparison budget.');
  const concrete = new Map();
  const templates = new Map();
  const operations = [];
  const omissions = {};
  const v32 = openapi.openapi.startsWith('3.2.');
  const fields = v32 ? METHODS_V32 : METHODS;
  let declaredPaths = 0;
  let indexedPaths = 0;
  let examinedOperations = 0;

  for (const path of keys.sort()) {
    if (path.startsWith('x-')) continue;
    declaredPaths++;
    const compiled = compilePath(path);
    if (!compiled) {
      count(omissions, 'unsupported_path');
      continue;
    }
    const item = paths[path];
    const unavailable = !record(item) ? 'invalid_path_item' : Object.hasOwn(item, '$ref') ? 'unresolved_path_reference' : null;
    const entry = { patterns: compiled.patterns, unavailable, operations: new Map() };
    if (compiled.templated) append(templates, compiled.patterns.length, entry);
    else append(concrete, pathKey(path), entry);
    indexedPaths++;
    if (unavailable) {
      count(omissions, unavailable);
      continue;
    }

    const definitions = fields
      .filter(field => Object.hasOwn(item, field))
      .map(field => [field.toUpperCase(), item[field]]);
    examinedOperations += definitions.length;
    const additional = item.additionalOperations;
    if (v32 && record(additional)) {
      const methods = Object.keys(additional);
      examinedOperations += methods.length;
      if (examinedOperations > MAX_OPERATIONS) throw new RpmError('api_contract_bounds', 'OpenAPI operation entries exceed the comparison budget.');
      for (const method of methods.sort()) {
        if (!METHOD_TOKEN.test(method) || fields.some(field => method === field.toUpperCase())) {
          count(omissions, 'invalid_additional_method');
          continue;
        }
        definitions.push([method, additional[method]]);
      }
    } else if (Object.hasOwn(item, 'additionalOperations')) {
      count(omissions, 'unsupported_additional_operations');
    }
    if (examinedOperations > MAX_OPERATIONS) throw new RpmError('api_contract_bounds', 'OpenAPI operation entries exceed the comparison budget.');
    for (const [method, operation] of definitions) {
      if (!record(operation) || Object.hasOwn(operation, '$ref')) {
        count(omissions, 'unavailable_operation');
        entry.operations.set(method, null);
        continue;
      }
      entry.operations.set(method, operations.length);
      operations.push({ method, path, observed_count: 0, ambiguous_count: 0 });
    }
  }
  return { concrete, templates, operations, omissions, declaredPaths, indexedPaths };
}

function requestPath(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > MAX_URL_LENGTH || /[\x00-\x20\x7f\\]/u.test(rawUrl)) return null;
  const raw = /^https?:\/\/[^/?#]+(\/[^?#]*)?/iu.exec(rawUrl);
  if (!raw) return null;
  const pathname = raw[1] ?? '/';
  try {
    if (new URL(rawUrl).pathname !== pathname) return null;
  } catch {
    return null;
  }
  const segments = pathSegments(pathname);
  if (!segments || !segments.every(segment => PATH_LITERAL.test(segment))) return null;
  return { pathname: pathKey(pathname), segments: segments.map(pathKey) };
}

function correlate(contract, request, budget) {
  if (!record(request) || typeof request.method !== 'string' || !METHOD_TOKEN.test(request.method)) {
    return { status: 'omitted', reason: 'invalid_request_method' };
  }
  const target = requestPath(request.url);
  if (!target) return { status: 'omitted', reason: 'unsupported_request_url' };
  let candidates = contract.concrete.get(target.pathname);
  if (!candidates) {
    const possible = contract.templates.get(target.segments.length) ?? [];
    if (possible.length > budget.remaining) return { status: 'omitted', reason: 'route_check_budget' };
    budget.remaining -= possible.length;
    candidates = possible.filter(entry => entry.patterns.every((literals, index) => matchSegment(literals, target.segments[index])));
  }

  if (candidates.length === 0) return { status: 'unmatched', reason: 'no_supported_path' };
  if (candidates.length > 1) {
    const indices = [];
    let operationCount = 0;
    for (const candidate of candidates) {
      const index = candidate.operations.get(request.method);
      if (!Number.isInteger(index)) continue;
      contract.operations[index].ambiguous_count++;
      if (indices.length < MAX_REPORTED_AMBIGUITY) indices.push(index);
      operationCount++;
    }
    return { status: 'ambiguous', candidate_path_count: candidates.length, candidate_operation_count: operationCount, candidate_operation_indices: indices };
  }
  const [candidate] = candidates;
  if (candidate.unavailable) return { status: 'omitted', reason: candidate.unavailable };
  const index = candidate.operations.get(request.method);
  if (index === null) return { status: 'omitted', reason: 'unavailable_operation' };
  if (index === undefined) return { status: 'unmatched', reason: 'no_declared_method' };
  contract.operations[index].observed_count++;
  return { status: 'observed', operation_index: index };
}

export function compareApiContract(openapi, har) {
  const entries = record(har) && record(har.log) ? har.log.entries : null;
  if (!Array.isArray(entries)) throw new RpmError('api_contract_input', 'Provide saved HAR JSON with a log.entries array.');
  if (entries.length > MAX_ENTRIES) throw new RpmError('api_contract_bounds', 'HAR entries exceed the comparison budget.');
  const contract = indexContract(openapi);
  const budget = { remaining: MAX_ROUTE_CHECKS };
  const observationTotals = { observed: 0, ambiguous: 0, unmatched: 0, omitted: 0 };
  const observationOmissions = {};
  const observations = Array.from(entries, (entry, index) => {
    const result = correlate(contract, entry?.request, budget);
    observationTotals[result.status]++;
    if (result.status === 'omitted') count(observationOmissions, result.reason);
    return { entry_index: index, ...result };
  });
  const operationTotals = { observed: 0, ambiguous: 0, unobserved: 0 };
  for (const operation of contract.operations) {
    operation.status = operation.observed_count ? 'observed' : operation.ambiguous_count ? 'ambiguous' : 'unobserved';
    operationTotals[operation.status]++;
  }
  const partial = observationTotals.ambiguous > 0 || observationTotals.omitted > 0 || Object.keys(contract.omissions).length > 0;
  return {
    schema_version: 1,
    kind: 'api-contract-comparison',
    openapi_version: openapi.openapi,
    status: partial ? 'partial' : 'complete',
    operations: contract.operations,
    observations,
    coverage: {
      declared_paths: contract.declaredPaths,
      indexed_paths: contract.indexedPaths,
      har_entries: entries.length,
      operations: operationTotals,
      observations: observationTotals,
      contract_omissions: contract.omissions,
      observation_omissions: observationOmissions,
      route_checks: MAX_ROUTE_CHECKS - budget.remaining,
    },
    limitations: [
      'The inventory covers paths and declared HTTP methods. Reference resolution, callbacks, webhooks and servers are outside its scope.',
      'Matching compares case-sensitive methods and full URL paths. Percent-encoded bytes stay opaque. Use a HAR scoped to the intended service because origins and server base paths are outside the comparison.',
      'Concrete paths take priority. A path parameter spans a nonempty part of one segment. Repeated parameter names and raw non-ASCII path literals are omitted.',
      'Coverage describes this saved capture only. An observed request does not establish that the server recognized it, responded successfully, or met the contract. An unobserved declaration is not evidence of absence.',
    ],
  };
}
