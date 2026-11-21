export class WorldError extends Error {
  constructor(code, location, detail = '') {
    super([code, location, detail].filter(Boolean).join(' · '));
    this.code = code;
    this.location = location;
  }
}
export function need(ok, code, location, message) {
  if (!ok) throw new WorldError(code, location, message);
}
export function key(source, id) {
  need(typeof source === 'string' && source.length && typeof id === 'string' && id.length, 'BAD_REFERENCE', 'source/id');
  return JSON.stringify([source, id]);
}
export const copy = value => structuredClone(value);
export function equalValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(key => Object.hasOwn(right, key) && equalValue(left[key], right[key]));
}
export const emptyCatalog = () => ({ types: [], objects: [], rules: [], listeners: [], macros: [], sources: [], renderers:[] });
export const emptySlot = () => ({ changes: {}, locks: {}, calls: [], jobs: {}, enabled: [], receipts: {}, visits: {} });
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
export function identifier(value, where) {
  need(typeof value === 'string' && value.trim().length && !reserved.has(value), 'BAD_ID', where);
  return value;
}
export function checkValue(value, spec, where) {
  const kind = typeof spec === 'string' ? spec : spec?.kind;
  const matches = {
    number: Number.isFinite(value), text: typeof value === 'string', boolean: typeof value === 'boolean',
    ref: !!value && typeof value.source === 'string' && typeof value.id === 'string' && !!value.source && !!value.id,
    fragment: !!value && !!value.chapterId && !!value.fragmentId, list: Array.isArray(value),
    action: !!value && typeof value.source==='string' && !!value.source && typeof value.method==='string' && !!value.method,
    object: !!value && typeof value === 'object' && !Array.isArray(value)
  };
  need(Object.hasOwn(matches, kind) && matches[kind], 'TYPE_MISMATCH', where, kind);
  if (kind === 'list' && spec.items) value.forEach((item, n) => checkValue(item, spec.items, where + '[' + n + ']'));
  if (kind === 'object' && spec.fields) validateFields(value, spec.fields, where);
}
function validateFields(data, fields, where) {
  for (const [name, value] of Object.entries(data)) {
    identifier(name, where);
    need(Object.hasOwn(fields, name), 'UNKNOWN_FIELD', where + '.' + name);
    checkValue(value, fields[name], where + '.' + name);
  }
}
function indexAdd(index, k, value) {
  if (!index.has(k)) index.set(k, new Set());
  index.get(k).add(value);
}
export class World {
  constructor(catalog = emptyCatalog(), slot = emptySlot(), save = () => {}) {
    this.catalog = catalog;
    this.slot = slot;
    this.save = save;
    this.types = new Map();
    this.localSources = new Set(['world']);
    this.objects = new Map();
    this.groups = new Map();
    this.tags = new Map();
    this.relations = new Map();
    this.base = new Map();
    for (const group of ['types', 'objects', 'rules', 'listeners', 'macros', 'sources']) {
      need(Array.isArray(catalog[group]), 'BAD_CATALOG', group);
      const ids = new Set();
      for (const row of catalog[group]) {
        const identity = group === 'types' || group === 'objects' ? key(row.source, row.id) : identifier(row.id, group);
        need(!ids.has(identity), 'DUPLICATE_ID', group, identity);
        ids.add(identity);
      }
    }
    for (const type of catalog.types) {
      need(type.fields && typeof type.fields === 'object', 'BAD_FIELDS', type.id);
      validateFields(type.defaults || {}, type.fields, type.id);
      this.types.set(key(type.source, type.id), type);
      this.localSources.add(type.source);
    }
    for (const row of catalog.objects) {
      const k = key(row.source, row.id);
      this.base.set(k, row);
      if (!Object.hasOwn(slot.changes, k)) this.install(k, this.normalize(row));
    }
    for (const [k, row] of Object.entries(slot.changes)) {
      if (row !== null) {
        need(key(row.source, row.id) === k, 'INVALID_SAVE', k);
        this.install(k, this.normalize(row));
      }
    }
  }
  normalize(row) {
    const type = this.types.get(key(row.source, row.type));
    need(type, 'TYPE_MISSING', row.type);
    const fields = { ...type.defaults, ...row.fields };
    validateFields(fields, type.fields, row.id);
    for (const [name, spec] of Object.entries(type.fields))
      if (spec.required) need(Object.hasOwn(fields, name), 'FIELD_REQUIRED', row.id + '.' + name);
    const tags = [...new Set(row.tags || [])];
    for (const tag of tags) identifier(tag, row.id);
    return { ...row, fields, tags };
  }
  indices(row) {
    const entries = [[this.groups, key(row.source, row.type)]];
    for (const tag of row.tags) entries.push([this.tags, tag]);
    for (const [field, val] of Object.entries(row.fields)) {
      if (val && typeof val === 'object' && val.source && val.id)
        entries.push([this.relations, JSON.stringify([field, val.source, val.id])]);
    }
    return entries;
  }
  install(k, row) {
    const old = this.objects.get(k);
    if (old) for (const [index, label] of this.indices(old)) {
      const set = index.get(label);
      set.delete(k);
      if (!set.size) index.delete(label);
    }
    if (!row) { this.objects.delete(k); return; }
    this.objects.set(k, row);
    for (const [index, label] of this.indices(row)) indexAdd(index, label, k);
  }
  get(ref) {
    const k = key(ref.source, ref.id);
    need(this.localSources.has(ref.source),'SOURCE_MISSING',ref.source);
    const row = this.objects.get(k);
    if (row) return copy(row);
    throw new WorldError(Object.hasOwn(this.slot.changes, k) ? 'CONSUMED' : 'OBJECT_MISSING', k);
  }
  read(ref, path = []) {
    let value = this.get(ref).fields;
    for (const field of path) {
      identifier(field, 'path');
      if (value?.source && value?.id) value = this.get(value).fields;
      need(value != null && Object.hasOwn(value, field), 'FIELD_MISSING', field);
      value = value[field];
    }
    return copy(value);
  }
  query({ source, type, tag, relation, where = {}, mode = 'list' }) {
    if (source) need(this.localSources.has(source),'SOURCE_MISSING',source);
    const options = [];
    if (type) options.push(this.groups.get(key(source, type)));
    if (tag) options.push(this.tags.get(tag));
    if (relation) options.push(this.relations.get(JSON.stringify([relation.field, relation.target.source, relation.target.id])));
    need(options.length, 'QUERY_SCOPE_REQUIRED', 'query');
    const sets = options.map(set => set || new Set()).sort((a, b) => a.size - b.size);
    const found = [];
    for (const k of sets[0]) {
      const row = this.objects.get(k);
      if ((source && row.source !== source) || !sets.every(set => set.has(k))) continue;
      if (!Object.entries(where).every(([f, v]) => Object.hasOwn(row.fields, f) && equalValue(row.fields[f], v))) continue;
      if (mode === 'exists') return true;
      found.push({ source: row.source, id: row.id });
    }
    if (mode === 'exists') return false;
    if (mode === 'count') return found.length;
    if (mode === 'one') {
      need(found.length === 1, found.length ? 'AMBIGUOUS' : 'NO_MATCH', 'query');
      return found[0];
    }
    need(mode === 'list', 'BAD_QUERY_MODE', mode);
    return found;
  }
  commit(operations, receipt, result = true) {
    if (receipt && Object.hasOwn(this.slot.receipts, receipt)) return copy(this.slot.receipts[receipt]);
    const pending = new Map();
    for (const op of operations) {
      const k = key(op.ref.source, op.ref.id);
      need(!this.catalog.sources.some(owner => owner.id === op.ref.source), 'OWNER_REQUIRED', k);
      const current = pending.has(k) ? pending.get(k) : this.objects.get(k);
      if (op.kind === 'create') {
        need(!current && !pending.has(k) && !Object.hasOwn(this.slot.changes, k) && !this.base.has(k), 'ID_USED', k);
        pending.set(k, this.normalize({ ...copy(op.row), ...op.ref }));
      } else {
        need(current, 'OBJECT_MISSING', k);
        if (op.kind === 'consume') { pending.set(k, null); continue; }
        identifier(op.field, k);
        need(['set','add'].includes(op.kind), 'BAD_OPERATION', op.kind);
        let value = copy(op.value);
        if (op.kind === 'add') {
          checkValue(value, 'number', op.field);
          checkValue(current.fields[op.field], 'number', op.field);
          value += current.fields[op.field];
        }
        pending.set(k, this.normalize({ ...current, fields: { ...current.fields, [op.field]: value } }));
      }
    }
    if (typeof result === 'function') result=result(pending,this.objects);
    const next = { ...this.slot, changes: { ...this.slot.changes, ...Object.fromEntries(pending) },
      receipts: receipt ? { ...this.slot.receipts, [receipt]: copy(result) } : this.slot.receipts };
    this.save(next);
    this.slot = next;
    for (const [k, row] of pending) this.install(k, row);
    return copy(result);
  }
  update(patch) {
    const next = { ...this.slot, ...patch };
    this.save(next);
    this.slot = next;
  }
}
