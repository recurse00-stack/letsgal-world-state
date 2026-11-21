// src/runtime.js
import { Extension, extension, defineSave, settings } from "@avg-studio/sdk";

// src/world.js
var WorldError = class extends Error {
  constructor(code, location, detail = "") {
    super([code, location, detail].filter(Boolean).join(" \xB7 "));
    this.code = code;
    this.location = location;
  }
};
function need(ok, code, location, message) {
  if (!ok) throw new WorldError(code, location, message);
}
function key(source, id) {
  need(typeof source === "string" && source.length && typeof id === "string" && id.length, "BAD_REFERENCE", "source/id");
  return JSON.stringify([source, id]);
}
var copy = (value) => structuredClone(value);
function equalValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key2) => Object.hasOwn(right, key2) && equalValue(left[key2], right[key2]));
}
var emptyCatalog = () => ({ types: [], objects: [], rules: [], listeners: [], macros: [], sources: [], renderers: [] });
var emptySlot = () => ({ changes: {}, locks: {}, calls: [], jobs: {}, enabled: [], receipts: {}, visits: {} });
var reserved = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
function identifier(value, where) {
  need(typeof value === "string" && value.trim().length && !reserved.has(value), "BAD_ID", where);
  return value;
}
function checkValue(value, spec, where) {
  const kind = typeof spec === "string" ? spec : spec?.kind;
  const matches = {
    number: Number.isFinite(value),
    text: typeof value === "string",
    boolean: typeof value === "boolean",
    ref: !!value && typeof value.source === "string" && typeof value.id === "string" && !!value.source && !!value.id,
    fragment: !!value && !!value.chapterId && !!value.fragmentId,
    list: Array.isArray(value),
    action: !!value && typeof value.source === "string" && !!value.source && typeof value.method === "string" && !!value.method,
    object: !!value && typeof value === "object" && !Array.isArray(value)
  };
  need(Object.hasOwn(matches, kind) && matches[kind], "TYPE_MISMATCH", where, kind);
  if (kind === "list" && spec.items) value.forEach((item, n) => checkValue(item, spec.items, where + "[" + n + "]"));
  if (kind === "object" && spec.fields) validateFields(value, spec.fields, where);
}
function validateFields(data2, fields, where) {
  for (const [name, value] of Object.entries(data2)) {
    identifier(name, where);
    need(Object.hasOwn(fields, name), "UNKNOWN_FIELD", where + "." + name);
    checkValue(value, fields[name], where + "." + name);
  }
}
function indexAdd(index, k, value) {
  if (!index.has(k)) index.set(k, /* @__PURE__ */ new Set());
  index.get(k).add(value);
}
var World = class {
  constructor(catalog = emptyCatalog(), slot = emptySlot(), save = () => {
  }) {
    this.catalog = catalog;
    this.slot = slot;
    this.save = save;
    this.types = /* @__PURE__ */ new Map();
    this.localSources = /* @__PURE__ */ new Set(["world"]);
    this.objects = /* @__PURE__ */ new Map();
    this.groups = /* @__PURE__ */ new Map();
    this.tags = /* @__PURE__ */ new Map();
    this.relations = /* @__PURE__ */ new Map();
    this.base = /* @__PURE__ */ new Map();
    for (const group of ["types", "objects", "rules", "listeners", "macros", "sources"]) {
      need(Array.isArray(catalog[group]), "BAD_CATALOG", group);
      const ids = /* @__PURE__ */ new Set();
      for (const row of catalog[group]) {
        const identity = group === "types" || group === "objects" ? key(row.source, row.id) : identifier(row.id, group);
        need(!ids.has(identity), "DUPLICATE_ID", group, identity);
        ids.add(identity);
      }
    }
    for (const type of catalog.types) {
      need(type.fields && typeof type.fields === "object", "BAD_FIELDS", type.id);
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
        need(key(row.source, row.id) === k, "INVALID_SAVE", k);
        this.install(k, this.normalize(row));
      }
    }
  }
  normalize(row) {
    const type = this.types.get(key(row.source, row.type));
    need(type, "TYPE_MISSING", row.type);
    const fields = { ...type.defaults, ...row.fields };
    validateFields(fields, type.fields, row.id);
    for (const [name, spec] of Object.entries(type.fields))
      if (spec.required) need(Object.hasOwn(fields, name), "FIELD_REQUIRED", row.id + "." + name);
    const tags = [...new Set(row.tags || [])];
    for (const tag of tags) identifier(tag, row.id);
    return { ...row, fields, tags };
  }
  indices(row) {
    const entries = [[this.groups, key(row.source, row.type)]];
    for (const tag of row.tags) entries.push([this.tags, tag]);
    for (const [field, val] of Object.entries(row.fields)) {
      if (val && typeof val === "object" && val.source && val.id)
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
    if (!row) {
      this.objects.delete(k);
      return;
    }
    this.objects.set(k, row);
    for (const [index, label] of this.indices(row)) indexAdd(index, label, k);
  }
  get(ref) {
    const k = key(ref.source, ref.id);
    need(this.localSources.has(ref.source), "SOURCE_MISSING", ref.source);
    const row = this.objects.get(k);
    if (row) return copy(row);
    throw new WorldError(Object.hasOwn(this.slot.changes, k) ? "CONSUMED" : "OBJECT_MISSING", k);
  }
  read(ref, path = []) {
    let value = this.get(ref).fields;
    for (const field of path) {
      identifier(field, "path");
      if (value?.source && value?.id) value = this.get(value).fields;
      need(value != null && Object.hasOwn(value, field), "FIELD_MISSING", field);
      value = value[field];
    }
    return copy(value);
  }
  query({ source, type, tag, relation, where = {}, mode = "list" }) {
    if (source) need(this.localSources.has(source), "SOURCE_MISSING", source);
    const options = [];
    if (type) options.push(this.groups.get(key(source, type)));
    if (tag) options.push(this.tags.get(tag));
    if (relation) options.push(this.relations.get(JSON.stringify([relation.field, relation.target.source, relation.target.id])));
    need(options.length, "QUERY_SCOPE_REQUIRED", "query");
    const sets = options.map((set) => set || /* @__PURE__ */ new Set()).sort((a, b) => a.size - b.size);
    const found = [];
    for (const k of sets[0]) {
      const row = this.objects.get(k);
      if (source && row.source !== source || !sets.every((set) => set.has(k))) continue;
      if (!Object.entries(where).every(([f, v]) => Object.hasOwn(row.fields, f) && equalValue(row.fields[f], v))) continue;
      if (mode === "exists") return true;
      found.push({ source: row.source, id: row.id });
    }
    if (mode === "exists") return false;
    if (mode === "count") return found.length;
    if (mode === "one") {
      need(found.length === 1, found.length ? "AMBIGUOUS" : "NO_MATCH", "query");
      return found[0];
    }
    need(mode === "list", "BAD_QUERY_MODE", mode);
    return found;
  }
  commit(operations, receipt, result = true) {
    if (receipt && Object.hasOwn(this.slot.receipts, receipt)) return copy(this.slot.receipts[receipt]);
    const pending = /* @__PURE__ */ new Map();
    for (const op of operations) {
      const k = key(op.ref.source, op.ref.id);
      need(!this.catalog.sources.some((owner) => owner.id === op.ref.source), "OWNER_REQUIRED", k);
      const current = pending.has(k) ? pending.get(k) : this.objects.get(k);
      if (op.kind === "create") {
        need(!current && !pending.has(k) && !Object.hasOwn(this.slot.changes, k) && !this.base.has(k), "ID_USED", k);
        pending.set(k, this.normalize({ ...copy(op.row), ...op.ref }));
      } else {
        need(current, "OBJECT_MISSING", k);
        if (op.kind === "consume") {
          pending.set(k, null);
          continue;
        }
        identifier(op.field, k);
        need(["set", "add"].includes(op.kind), "BAD_OPERATION", op.kind);
        let value = copy(op.value);
        if (op.kind === "add") {
          checkValue(value, "number", op.field);
          checkValue(current.fields[op.field], "number", op.field);
          value += current.fields[op.field];
        }
        pending.set(k, this.normalize({ ...current, fields: { ...current.fields, [op.field]: value } }));
      }
    }
    if (typeof result === "function") result = result(pending, this.objects);
    const next = {
      ...this.slot,
      changes: { ...this.slot.changes, ...Object.fromEntries(pending) },
      receipts: receipt ? { ...this.slot.receipts, [receipt]: copy(result) } : this.slot.receipts
    };
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
};

// src/rules.js
var operators = new Map(Object.entries({
  eq: equalValue,
  ne: (a, b) => !equalValue(a, b),
  gt: (a, b) => a > b,
  ge: (a, b) => a >= b,
  lt: (a, b) => a < b,
  le: (a, b) => a <= b,
  plus: (a, b) => a + b,
  minus: (a, b) => a - b,
  times: (a, b) => a * b,
  divide: (a, b) => a / b
}));
var Rules = class {
  constructor(world, host = {}) {
    this.world = world;
    this.host = host;
    this.index = {};
    for (const group of ["rules", "listeners", "macros", "sources"])
      this.index[group] = new Map(world.catalog[group].map((row) => [row.id, row]));
    this.events = /* @__PURE__ */ new Map();
    for (const listener of this.index.listeners.values()) {
      const identity = listener.watch ? this.fieldEvent(listener.watch.source, listener.watch.type, listener.watch.field) : listener.event;
      if (!this.events.has(identity)) this.events.set(identity, []);
      this.events.get(identity).push(listener);
    }
  }
  item(group, id) {
    const item = this.index[group].get(id);
    need(item, "DEFINITION_MISSING", group + "/" + id);
    return item;
  }
  async value(node, args = {}, chain = []) {
    if (node == null || typeof node !== "object" || !node.op) return copy(node);
    const read = (x) => this.value(x, args, chain);
    switch (node.op) {
      case "arg": {
        let v = args;
        for (const part of node.path) {
          identifier(part, "arg");
          need(v != null && Object.hasOwn(v, part), "ARG_MISSING", node.path.join("."));
          v = v[part];
        }
        return copy(v);
      }
      case "read": {
        const ref = await read(node.ref);
        const path = node.path || [];
        if (!path.length) return this.index.sources.has(ref.source) ? this.host.request(ref.source, "read", { ref, path }, args) : this.world.read(ref);
        let current = ref;
        for (const field of path) {
          identifier(field, "path");
          if (current?.source && current?.id) {
            current = this.index.sources.has(current.source) ? await this.host.request(current.source, "read", { ref: current, path: [field] }, args) : this.world.read(current, [field]);
          } else {
            need(current != null && Object.hasOwn(current, field), "FIELD_MISSING", field);
            current = current[field];
          }
        }
        return copy(current);
      }
      case "query": {
        const scope = await read(node.scope);
        const sources = scope.sources ?? [scope.source];
        if (sources.length === 1 && !this.index.sources.has(sources[0])) return this.world.query({ ...scope, source: sources[0] });
        const lists = await Promise.all(sources.map((source) => {
          const filter = { ...scope, source, mode: "list" };
          delete filter.sources;
          return this.index.sources.has(source) ? this.host.request(source, "query", filter, args) : this.world.query(filter);
        }));
        const rows = [...new Map(lists.flat().map((ref) => [JSON.stringify([ref.source, ref.id]), ref])).values()];
        switch (scope.mode ?? "list") {
          case "list":
            return rows;
          case "count":
            return rows.length;
          case "exists":
            return rows.length > 0;
          case "one":
            need(rows.length === 1, rows.length ? "AMBIGUOUS" : "NO_MATCH", "query");
            return rows[0];
          default:
            throw new WorldError("BAD_QUERY_MODE", "query", scope.mode);
        }
      }
      case "object":
        return Object.fromEntries(await Promise.all(Object.entries(node.fields).map(async ([k, v]) => [identifier(k, "object"), await read(v)])));
      case "list":
        return Promise.all(node.items.map(read));
      case "all":
        for (const n of node.items) {
          if (!await read(n)) return false;
        }
        return true;
      case "any":
        for (const n of node.items) {
          if (await read(n)) return true;
        }
        return false;
      case "not":
        return !await read(node.value);
      case "rule": {
        need(!chain.includes(node.id), "RULE_CYCLE", [...chain, node.id].join(" \u2192 "));
        return this.value(this.item("rules", node.id).condition, await read(node.args ?? args), [...chain, node.id]);
      }
      default: {
        const fn = operators.get(node.op);
        need(fn, "UNKNOWN_EXPRESSION", node.op);
        const a = await read(node.left), b = await read(node.right);
        if (!["eq", "ne"].includes(node.op)) need(Number.isFinite(a) && Number.isFinite(b), "TYPE_MISMATCH", node.op, "number");
        const result = fn(a, b);
        need(typeof result !== "number" || Number.isFinite(result), "NUMBER_RANGE", node.op);
        return result;
      }
    }
  }
  async choose(branches, args, memory, check = () => {
  }) {
    if (memory && Object.hasOwn(this.world.slot.locks, memory)) return this.world.slot.locks[memory];
    let index = -1;
    for (const [i, b] of branches.entries()) if (b.condition === void 0 || await this.value(b.condition, args)) {
      index = i;
      break;
    }
    check();
    if (memory) this.world.update({ locks: { ...this.world.slot.locks, [memory]: index } });
    return index;
  }
  enable(id, scope, enabled) {
    this.item("listeners", id);
    const identity = JSON.stringify([id, scope]);
    const set = new Set(this.world.slot.enabled);
    if (enabled) set.add(identity);
    else set.delete(identity);
    this.world.update({ enabled: [...set] });
  }
  fieldEvent(source, type, field) {
    return JSON.stringify(["field", source, type, field]);
  }
  changes(pending, previous, includeAll = false) {
    const result = [];
    for (const [id, row] of pending) {
      const old = previous.get(id), identity = row ?? old;
      const fields = /* @__PURE__ */ new Set([...Object.keys(old?.fields ?? {}), ...Object.keys(row?.fields ?? {})]);
      for (const field of fields) {
        const event = this.fieldEvent(identity.source, identity.type, field);
        if (!includeAll && !this.events.has(event)) continue;
        const before = old?.fields[field], after = row?.fields[field];
        if (!equalValue(before, after)) result.push({
          event,
          ref: { source: identity.source, id: identity.id },
          field,
          before: before ?? null,
          after: after ?? null
        });
      }
    }
    return result;
  }
  async dispatch(event, scope, args, fire) {
    const enabled = new Set(this.world.slot.enabled);
    let checks = 0;
    for (const listener of this.events.get(event) || []) {
      if (!enabled.has(JSON.stringify([listener.id, scope])) && !enabled.has(JSON.stringify([listener.id, "*"]))) continue;
      checks++;
      if (await this.value(listener.condition, args)) await fire(listener);
    }
    return checks;
  }
};
function carryRecord(known, allowed) {
  need(Array.isArray(known) && Array.isArray(allowed), "TYPE_MISMATCH", "\u901A\u5173\u77E5\u8BC6", "list");
  const identity = (v) => {
    if (typeof v === "string") return JSON.stringify(["id", identifier(v, "\u77E5\u8BC6\u7F16\u53F7")]);
    need(v && typeof v.source === "string" && typeof v.id === "string", "BAD_REFERENCE", "\u77E5\u8BC6\u7F16\u53F7");
    return JSON.stringify(["ref", v.source, v.id]);
  };
  const allowedIds = new Set(allowed.map(identity)), seen = /* @__PURE__ */ new Set();
  return known.filter((item) => {
    const key2 = identity(item);
    if (!allowedIds.has(key2) || seen.has(key2)) return false;
    seen.add(key2);
    return true;
  }).map(copy);
}
function requireMethod(catalog, source, method) {
  const owner = catalog.sources.find((row) => row.id === source);
  if (!owner) throw new WorldError("SOURCE_MISSING", source);
  const spec = owner.methods?.find((row) => row.id === method);
  if (!spec) throw new WorldError("METHOD_MISSING", [source, method].join("/"));
  return spec;
}

// src/play.js
var Player = class {
  constructor(rules, host) {
    this.rules = rules;
    this.world = rules.world;
    this.host = host;
    this.active = [];
    this.pending = /* @__PURE__ */ new Map();
    this.controllers = /* @__PURE__ */ new Map();
  }
  frame(id) {
    const f = this.world.slot.calls.find((c) => c.id === id) ?? this.world.slot.jobs?.[id];
    need(f, "CALL_MISSING", id);
    return f;
  }
  checkJob(id) {
    this.host.check();
    need(!this.controllers.get(id)?.signal.aborted && this.world.slot.jobs?.[id]?.status !== "cancelled", "CANCELLED", id);
  }
  patch(id, update) {
    this.checkJob(id);
    if (Object.hasOwn(this.world.slot.jobs ?? {}, id)) {
      const jobs = this.world.slot.jobs, current = jobs[id];
      this.world.update({ jobs: { ...jobs, [id]: { ...current, ...update(current) } } });
      return;
    }
    this.world.update({ calls: this.world.slot.calls.map((c) => c.id === id ? { ...c, ...update(c) } : c) });
  }
  async run(site, steps, args = {}, { ticket } = {}) {
    this.host.check();
    const depth = this.active.length;
    let frame;
    const receipt = ticket ? "external/" + ticket : null;
    if (receipt && Object.hasOwn(this.world.slot.receipts, receipt)) return copy(this.world.slot.receipts[receipt]);
    if (receipt) frame = this.world.slot.calls.find((f) => f.ticket === ticket);
    if (!frame && !ticket && this.host.restoring()) {
      frame = this.world.slot.calls.find((f) => f.site === site && f.parent === (this.active.at(-1) ?? null));
      need(frame, "RESTORE_FRAME_MISSING", site);
    } else if (!frame) {
      frame = { id: crypto.randomUUID(), site, parent: this.active.at(-1) ?? null, args: copy(args), done: {}, values: {}, choices: {}, result: null, steps: copy(steps), ...ticket ? { ticket } : {} };
      this.world.update({ calls: [...this.world.slot.calls, frame] });
    }
    this.active.push(frame.id);
    try {
      await this.sequence(frame.id, frame.steps, "root");
      const result = this.frame(frame.id).result;
      this.host.check();
      const receipts = { ...this.world.slot.receipts };
      for (const key2 of Object.keys(receipts)) if (key2.startsWith(frame.id + "root/")) delete receipts[key2];
      if (receipt) receipts[receipt] = result;
      this.world.update({ calls: this.world.slot.calls.filter((f) => f.id !== frame.id), receipts });
      this.compact();
      return result;
    } finally {
      this.active.splice(depth, 1);
    }
  }
  async sequence(id, steps, path, context) {
    need(Array.isArray(steps), "BAD_STEP_LIST", path);
    need(path.split("/").length < 256, "RULE_DEPTH", path);
    for (const [i, step] of steps.entries()) {
      const position = path + "/" + i;
      let failure = this.frame(id).errors?.[position];
      if (!failure) {
        try {
          await this.step(id, step, position, context);
          continue;
        } catch (error) {
          this.checkJob(id);
          failure = { code: error.code ?? "ACTION_FAILED", location: error.location ?? position, message: error.message, ticket: id + position };
          this.host.trace?.({ call: id, step: position, action: step.kind, status: "failed", ...failure });
          if (!Array.isArray(step.onError)) throw error;
          this.patch(id, (c) => ({ errors: { ...c.errors, [position]: failure } }));
        }
      }
      await this.sequence(id, step.onError, position + "/error", { ...context, error: failure });
    }
  }
  compact() {
    const jobs = { ...this.world.slot.jobs };
    const live = new Set(this.world.slot.calls.map((c) => c.id));
    let changed = false;
    for (const [id, job] of Object.entries(jobs)) if (job.status !== "pending" && !live.has(job.parent)) {
      delete jobs[id];
      changed = true;
    }
    if (changed) this.world.update({ jobs });
  }
  driveJob(id) {
    const job = this.frame(id);
    if (job.status === "done") return Promise.resolve(job.result);
    if (job.status === "cancelled") return Promise.reject(new WorldError("CANCELLED", id));
    if (job.status === "failed") return Promise.reject(new WorldError(job.errorCode || "ACTION_FAILED", id, job.error));
    if (this.pending.has(id)) return this.pending.get(id);
    this.controllers.set(id, new AbortController());
    const run = Promise.resolve().then(async () => {
      try {
        await this.sequence(id, job.steps, "work");
        const result = this.frame(id).result;
        this.patch(id, () => ({ status: "done" }));
        this.compact();
        return result;
      } catch (error) {
        this.checkJob(id);
        this.patch(id, () => ({ status: "failed", error: error.message, errorCode: error.code }));
        this.host.report?.(error);
        throw error;
      } finally {
        this.pending.delete(id);
        this.controllers.delete(id);
      }
    });
    this.pending.set(id, run);
    return run;
  }
  resumeJobs() {
    for (const [id, job] of Object.entries(this.world.slot.jobs ?? {}))
      if (job.status === "pending") this.driveJob(id).catch(() => {
      });
  }
  async step(id, step, path, context) {
    this.checkJob(id);
    const f = this.frame(id);
    if (Object.hasOwn(f.done, path)) return f.done[path];
    const args = { ...f.args, ...context, results: f.values };
    const value = (n) => this.rules.value(n, args);
    let input = f.inputs?.[path];
    if (input === void 0) {
      input = await value(step.args ?? {});
      if (step.args !== void 0) this.patch(id, (c) => ({ inputs: { ...c.inputs, [path]: input } }));
    }
    let result = null;
    switch (step.kind) {
      case "spawn": {
        const receipt = id + path;
        let created = this.world.slot.receipts[receipt];
        if (!created) {
          const count = await value(step.count ?? 1), row = await value(step.row);
          need(Number.isSafeInteger(count) && count >= 0, "BAD_COUNT", path);
          const refs = Array.from({ length: count }, () => ({ source: step.source ?? "world", id: crypto.randomUUID() }));
          this.checkJob(id);
          created = this.world.commit(refs.map((ref) => ({ kind: "create", ref, row })), receipt, (pending, previous) => ({
            refs,
            changes: this.rules.changes(pending, previous, this.host.tracing?.())
          }));
        }
        for (const [i, change] of created.changes.entries()) {
          const eventArgs = { ...args, change };
          await this.rules.dispatch(change.event, change.ref.id, eventArgs, (listener) => this.sequence(id, listener.steps, path + "/change/" + i + "/" + listener.id, eventArgs));
        }
        result = created.refs;
        break;
      }
      case "write": {
        const ops = [];
        for (const op of step.operations) ops.push({ ...op, ref: await value(op.ref), value: await value(op.value), row: await value(op.row) });
        this.checkJob(id);
        const changes = this.world.commit(ops, id + path, (pending, previous) => this.rules.changes(pending, previous, this.host.tracing?.()));
        this.host.trace?.({ call: id, step: path, action: "write", changes });
        for (const [i, change] of changes.entries()) {
          const scope = step.scope === void 0 ? change.ref.id : await value(step.scope);
          const eventArgs = { ...args, change };
          await this.rules.dispatch(change.event, scope, eventArgs, (listener) => this.sequence(id, listener.steps, path + "/change/" + i + "/" + listener.id, eventArgs));
        }
        result = true;
        break;
      }
      case "method": {
        let binding = this.frame(id).bindings?.[path];
        if (!binding) {
          const descriptor = step.binding === void 0 ? step : await value(step.binding);
          need(descriptor && typeof descriptor.source === "string" && typeof descriptor.method === "string", "BAD_METHOD_BINDING", path);
          binding = { source: descriptor.source, method: descriptor.method, input: step.binding === void 0 ? input : await value(descriptor.args ?? {}) };
          this.patch(id, (c) => ({ bindings: { ...c.bindings, [path]: binding } }));
        }
        input = binding.input;
        const spec = requireMethod(this.world.catalog, binding.source, binding.method);
        for (const [k, s] of Object.entries(spec.inputs || {})) {
          if (s.required || Object.hasOwn(input, k)) checkValue(input[k], s, path + "." + k);
        }
        const ticket = id + path;
        this.checkJob(id);
        result = await this.host.request(binding.source, binding.method, input, { ticket, timeout: spec.timeoutMs, signal: this.controllers.get(id)?.signal });
        this.checkJob(id);
        if (spec.output) checkValue(result, spec.output, path + ".result");
        break;
      }
      case "branch": {
        let branch = f.choices[path];
        if (branch === void 0) {
          const memory = step.remember ? JSON.stringify([f.site, path, await value(step.scope ?? null)]) : null;
          branch = await this.rules.choose(step.branches, args, memory, () => this.checkJob(id));
          this.patch(id, (c) => ({ choices: { ...c.choices, [path]: branch } }));
        }
        this.host.trace?.({ call: id, step: path, action: "branch", selected: branch });
        if (branch >= 0) await this.sequence(id, step.branches[branch].steps, path + "/" + branch, context);
        break;
      }
      case "play":
      case "fragment":
      case "macro": {
        let targets = f.routes?.[path];
        if (!targets) {
          const selection = step.kind === "macro" ? this.rules.item("macros", step.id).target : await value(step.kind === "play" ? step.targets : step.target);
          targets = Array.isArray(selection) ? selection : [selection];
          for (const target of targets) checkValue(target, "fragment", path);
          this.patch(id, (c) => ({ routes: { ...c.routes, [path]: targets } }));
        }
        const returns = [];
        for (const [i, target] of targets.entries()) {
          const position = path + "/native/" + i;
          if (!Object.hasOwn(this.frame(id).done, position)) {
            const returned = await this.host.fragment(target, input) ?? null;
            this.patch(id, (c) => ({ done: { ...c.done, [position]: returned } }));
          }
          returns.push(this.frame(id).done[position]);
        }
        result = step.kind === "play" ? returns : returns[0] ?? null;
        break;
      }
      case "lines": {
        let lines = f.lines?.[path];
        if (!lines) {
          lines = [];
          for (const line of step.rows) {
            const target = line.target ?? this.world.catalog.renderers?.find((r) => r.speaker === (line.speaker ?? ""))?.target;
            checkValue(target, "fragment", path + ".target");
            const text = await value(line.text);
            checkValue(text, "text", path + ".text");
            lines.push({ target, text, voice: line.voice ?? "", speaker: line.speaker ?? "" });
          }
          this.patch(id, (c) => ({ lines: { ...c.lines, [path]: lines } }));
        }
        for (const [i, line] of lines.entries()) {
          const position = path + "/line/" + i;
          if (Object.hasOwn(this.frame(id).done, position)) continue;
          await this.host.line(line);
          this.patch(id, (c) => ({ done: { ...c.done, [position]: true } }));
        }
        result = lines.length;
        break;
      }
      case "repeat": {
        let loop = f.loops?.[path] ?? { index: 0, inside: false };
        const saveLoop = (next) => this.patch(id, (c) => ({ loops: { ...c.loops, [path]: next } }));
        while (loop.inside || await value(step.condition)) {
          this.host.check();
          if (step.limit !== void 0) need(loop.index < step.limit, "REPEAT_LIMIT", path);
          if (!loop.inside) {
            loop = { ...loop, inside: true };
            saveLoop(loop);
          }
          await this.sequence(id, step.steps, path + "/turn/" + loop.index, context);
          loop = { index: loop.index + 1, inside: false };
          saveLoop(loop);
          if (loop.index % 64 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        }
        result = loop.index;
        break;
      }
      case "parallel": {
        const background = (action) => ["write", "spawn", "method", "return"].includes(action.kind) || action.kind === "branch" && action.branches.every((branch) => branch.steps.every(background)) || action.kind === "repeat" && action.steps.every(background);
        need(step.branches.every((branch) => branch.every(background)), "PARALLEL_INTERACTIVE", path);
        const join = step.join ?? "all";
        need(["all", "first", "none"].includes(join), "BAD_JOIN", path);
        const jobs = { ...this.world.slot.jobs }, ids = [];
        for (const [i, branch] of step.branches.entries()) {
          const child = id + path + "/parallel/" + i;
          ids.push(child);
          if (!jobs[child]) jobs[child] = {
            id: child,
            parent: id,
            site: f.site,
            args: copy(args),
            steps: copy(branch),
            status: "pending",
            choices: {},
            done: {},
            values: copy(f.values),
            result: null
          };
        }
        this.world.update({ jobs });
        const work = ids.map((child) => this.driveJob(child));
        for (const item of work) item.catch(() => {
        });
        if (join === "first" && work.length) await Promise.race(work);
        if (join === "all") {
          const outcomes = await Promise.allSettled(work);
          const failure = outcomes.find((item) => item.status === "rejected");
          if (failure) throw failure.reason;
        }
        result = ids;
        break;
      }
      case "cancel": {
        const ids = await value(step.jobs);
        need(Array.isArray(ids), "TYPE_MISMATCH", path, "list");
        const jobs = { ...this.world.slot.jobs };
        for (const child of ids) {
          need(Object.hasOwn(jobs, child), "JOB_MISSING", child);
          if (jobs[child].status === "pending") jobs[child] = { ...jobs[child], status: "cancelled" };
        }
        this.world.update({ jobs });
        for (const child of ids) if (jobs[child].status === "cancelled") this.controllers.get(child)?.abort();
        result = ids;
        break;
      }
      case "wait":
        result = await Promise.all((await value(step.jobs)).map((job) => this.driveJob(job)));
        break;
      case "listen":
        this.rules.enable(step.id, await value(step.scope), step.enabled);
        break;
      case "event":
        result = await this.rules.dispatch(
          step.event,
          await value(step.scope),
          input,
          (listener) => this.sequence(id, listener.steps, path + "/" + listener.id, input)
        );
        break;
      case "return":
        result = await value(step.value);
        this.patch(id, () => ({ result }));
        break;
      default:
        need(false, "BAD_STEP", path, step.kind);
    }
    this.patch(id, (c) => ({ done: { ...c.done, [path]: result }, values: step.as ? { ...c.values, [step.as]: result } : c.values }));
    this.host.trace?.({ call: id, step: path, action: step.kind, status: "done", result });
    return result;
  }
};

// src/channel.js
async function request(collection, source, method, args, { ticket = crypto.randomUUID(), signal, timeout = 1e4 } = {}) {
  signal?.throwIfAborted();
  const lookup = async () => (await collection.find({ ticket, source, method }, { limit: 1 }))[0];
  const prior = await lookup();
  if (prior) need(equalValue(prior.args, args), "TICKET_REUSED", ticket);
  const row = prior || await collection.insertOne({ ticket, source, method, args, status: "pending" });
  return new Promise((resolve, reject) => {
    let stop = () => {
    };
    let timer;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      stop();
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      fn(value);
    };
    const aborted = () => finish(reject, new WorldError("CANCELLED", ticket));
    const inspect = async () => {
      try {
        const current = await collection.getById(row.id);
        if (!current) return finish(reject, new WorldError("REQUEST_MISSING", ticket));
        if (current.status === "done") finish(resolve, current.result);
        if (current.status === "failed") finish(reject, new WorldError("PROVIDER_FAILED", ticket, current.reason));
      } catch (err) {
        finish(reject, err);
      }
    };
    stop = collection.watch(inspect);
    signal?.addEventListener("abort", aborted, { once: true });
    timer = setTimeout(() => finish(reject, new WorldError("RECEIPT_UNKNOWN", ticket)), timeout);
    if (signal?.aborted) aborted();
    else void inspect();
  });
}
function serve(collection, source, execute, onError = console.error) {
  const active = /* @__PURE__ */ new Set();
  let closed = false;
  const pump = async () => {
    const rows = await collection.find({ source, status: "pending" });
    await Promise.all(rows.map(async (row) => {
      if (closed || active.has(row.id)) return;
      active.add(row.id);
      try {
        let reply;
        try {
          reply = { status: "done", result: await execute(row) };
        } catch (e) {
          reply = { status: "failed", reason: String(e.message || e) };
        }
        if (!closed) await collection.updateOne({ id: row.id, status: "pending" }, { $set: reply });
      } finally {
        active.delete(row.id);
      }
    }));
  };
  const wake = () => {
    if (!closed) void pump().catch(onError);
  };
  const stop = collection.watch(wake);
  wake();
  return () => {
    closed = true;
    stop();
  };
}

// src/sources.js
function sourceDocument(doc) {
  if (typeof doc.declaration !== "string") return doc;
  try {
    return {
      ...JSON.parse(doc.declaration),
      id: doc.id,
      name: doc.name,
      source: doc.source,
      kind: doc.kind,
      definition: JSON.parse(doc.definition || "{}")
    };
  } catch {
    throw Error("\u6765\u6E90\u58F0\u660E\u683C\u5F0F\u9519\u8BEF \xB7 " + doc.source);
  }
}
function sourceDeclarations(documents) {
  return documents.map(sourceDocument).map((doc) => {
    need(typeof doc.source === "string" && Array.isArray(doc.methods), "BAD_SOURCE", doc.id);
    return { id: doc.source, name: doc.name || doc.source, methods: doc.methods, types: doc.types || [], objects: doc.objects || [] };
  });
}
function withDirectory(catalog, documents) {
  const exposed = sourceDeclarations(documents), ids = new Set(catalog.sources.map((s) => s.id));
  for (const source of exposed) {
    need(!ids.has(source.id), "DUPLICATE_SOURCE", source.id);
    ids.add(source.id);
  }
  return { ...catalog, sources: [...catalog.sources, ...exposed] };
}

// extension.json
var extension_default = {
  id: "mixing-entropy.world-state",
  name: "\u4E16\u754C\u72B6\u6001",
  description: "\u6309\u6765\u6E90\u3001\u5BF9\u8C61\u4E0E\u5173\u7CFB\u7EC4\u7EC7\u72B6\u6001\uFF0C\u5E76\u5728\u5267\u60C5\u53D1\u751F\u65F6\u68C0\u67E5\u4E0E\u8C03\u7528\u3002",
  version: "0.1.0",
  sdkVersion: "^3.0.0",
  entry: "dist/index.mjs",
  studioEntry: "dist/studio.js",
  dataDependencies: {
    directory: {
      name: "\u63A5\u5165\u6765\u6E90\u7684\u516C\u5F00\u5B9A\u4E49",
      contract: "world-state.sources",
      version: "^1.0.0",
      access: "read",
      autoCreate: { name: "\u4E16\u754C\u72B6\u6001\u6765\u6E90\u8D44\u6599", contractVersion: "1.0.0", runtimePolicy: "readonly", schema: { type: "object", titleColumn: "name", columns: [
        { key: "name", label: "\u6765\u6E90\u540D\u79F0", type: "text" },
        { key: "kind", label: "\u7C7B\u578B", type: "text" },
        { key: "source", label: "\u6765\u6E90\u7F16\u53F7", type: "text" },
        { key: "declaration", label: "\u516C\u5F00\u7ED3\u6784\u4E0E\u65B9\u6CD5", type: "long-text" },
        { key: "definition", label: "\u6765\u6E90\u5B9A\u4E49", type: "long-text" }
      ] } }
    },
    calls: {
      name: "\u4E16\u754C\u72B6\u6001\u8DE8\u6765\u6E90\u8C03\u7528",
      contract: "world-state.calls",
      version: "^1.0.0",
      access: "runtime-write",
      autoCreate: { name: "\u4E16\u754C\u72B6\u6001\u8C03\u7528", contractVersion: "1.0.0", runtimePolicy: "archive" }
    }
  }
};

// src/runtime.js
var localState = /* @__PURE__ */ new WeakMap();
var providers = /* @__PURE__ */ new WeakMap();
var parse = (s, defaults) => s ? JSON.parse(s) : defaults();
var data = (label, value) => ({ type: "data", label, default: value });
var str = (label) => ({ type: "string", label, default: "" });
function engine(ctx, save) {
  const raw = save.get("state");
  const definitions = ctx.settings.get("catalog") || "";
  const signal = ctx.flow.signal;
  let svc = localState.get(ctx.flow);
  if (svc && svc.raw === raw && svc.definitions === definitions && svc.signal === signal) return svc;
  svc = { raw, definitions, signal, child: [] };
  const check = () => {
    signal.throwIfAborted();
    need(localState.get(ctx.flow) === svc, "STALE_RUN", "world");
  };
  const world = new World(parse(definitions, emptyCatalog), parse(raw, emptySlot), (next) => {
    check();
    const encoded = JSON.stringify(next);
    save.set("state", encoded);
    svc.raw = encoded;
  });
  const host = {
    check,
    restoring: () => ctx.flow.isRestoring,
    tracing: () => !!ctx.settings.get("debug"),
    trace: (entry) => {
      if (ctx.settings.get("debug")) console.info("\u4E16\u754C\u72B6\u6001\u6B65\u9AA4", JSON.stringify(entry));
    },
    report: (error) => {
      if (ctx.settings.get("debug")) console.info("\u4E16\u754C\u72B6\u6001\u5E76\u884C\u4EFB\u52A1\u7ED3\u679C", error.code || "ACTION_FAILED", error.message);
    },
    request: (source, method, args, meta) => request(ctx.database.collection("calls"), source, method, args, {
      ticket: meta?.ticket,
      timeout: meta?.timeout,
      signal: meta?.signal ? AbortSignal.any([signal, meta.signal]) : signal
    }),
    async line(row) {
      check();
      if (save.get("lineText") !== row.text) save.set("lineText", row.text);
      if (row.voice && !ctx.flow.isRestoring) await ctx.sound.play(row.voice, { type: "VOCAL" });
      await host.fragment(row.target, { speaker: row.speaker, text: row.text });
    },
    async fragment(target, args) {
      need(!ctx.performance.isActive(), "PERFORMANCE_ACTIVE", target?.fragmentId);
      const chapter = await ctx.story.getChapter(target?.chapterId);
      const fragment = chapter?.fragments?.find((f) => f.id === target.fragmentId);
      need(fragment, "FRAGMENT_MISSING", JSON.stringify(target));
      need(!chapter.disabled && !fragment.disabled, "FRAGMENT_DISABLED", JSON.stringify(target));
      check();
      svc.child.push({ args, result: null });
      try {
        await ctx.flow.callFragment(target.fragmentId, { chapterId: target.chapterId });
        check();
        return svc.child.at(-1).result;
      } finally {
        svc.child.pop();
      }
    }
  };
  svc.world = world;
  svc.rules = new Rules(world, host);
  svc.player = new Player(svc.rules, host);
  localState.set(ctx.flow, svc);
  return svc;
}
async function ready(ctx, save) {
  const s = engine(ctx, save);
  if (!s.directoryLoad) {
    s.directoryLoad = ctx.database.collection("directory").find({ kind: "source" }).then((rows) => {
      s.player.host.check();
      const full = withDirectory(s.world.catalog, rows);
      s.world.catalog = full;
      s.rules.index.sources = new Map(full.sources.map((source) => [source.id, source]));
      s.player.resumeJobs();
    }).catch((err) => {
      s.directoryLoad = null;
      throw err;
    });
  }
  await s.directoryLoad;
  return s;
}
var schema = defineSave({
  lineText: { type: "string", default: "", persistence: "slot", label: "\u5F53\u524D\u539F\u4F4D\u5BF9\u767D\u6B63\u6587" },
  state: { type: "string", default: "", persistence: "slot", label: "\u5F53\u524D\u5468\u76EE" },
  finishes: { type: "string", default: "", persistence: "shared", label: "\u901A\u5173\u65F6\u5141\u8BB8\u7EE7\u627F\u7684\u77E5\u8BC6" },
  lastFinish: { type: "string", default: "", persistence: "shared", label: "\u6700\u8FD1\u4E00\u6B21\u767B\u8BB0\u7684\u901A\u5173\u7F16\u53F7" },
  permanent: { type: "string", default: "", persistence: "shared", label: "\u6C38\u4E45\u8BB0\u5F55" }
});
function accessor(kind) {
  return {
    title: { boolean: "\u68C0\u67E5\u6761\u4EF6", number: "\u8BFB\u53D6\u6570\u503C", string: "\u8BFB\u53D6\u6587\u672C" }[kind],
    returns: { type: kind, label: "\u7ED3\u679C" },
    schema: { expression: data("\u53D6\u503C\u6216\u6761\u4EF6", true), args: data("\u672C\u6B21\u53C2\u6570", {}) },
    async run(ctx, p) {
      const s = await ready(ctx, this.save);
      const v = await s.rules.value(p.expression, { ...s.child.at(-1)?.args, ...p.args });
      need(typeof v === kind, "TYPE_MISMATCH", "result", kind);
      return v;
    }
  };
}
var WorldService = class extends Extension.withSave(schema) {
  static onRegister(ctx) {
    const save = { get: (key2) => ctx.variables.get(extension_default.id + "." + key2), set: (key2, value) => ctx.variables.set(extension_default.id + "." + key2, value) };
    providers.get(ctx.flow)?.();
    const stop = serve(ctx.database.collection("calls"), "world", async (row) => {
      const s = await ready(ctx, save), p = row.args;
      if (row.method === "read") return s.world.read(p.ref, p.path);
      if (row.method === "query") return s.world.query(p);
      if (row.method === "write") {
        const worker = new Player(s.rules, s.player.host);
        return worker.run("world/write", [{ kind: "write", operations: p.operations, scope: p.scope }, { kind: "return", value: true }], {}, { ticket: row.ticket });
      }
      if (row.method === "check") return s.rules.value(p.expression, p.args);
      throw Error("METHOD_MISSING \xB7 world/" + row.method);
    });
    providers.set(ctx.flow, stop);
  }
  onInit() {
    void ready(this.context, this.save).catch((e) => {
      if (this.context.settings.get("debug")) console.error("\u4E16\u754C\u72B6\u6001", e.message);
    });
  }
  render() {
    return { component: Empty, props: {} };
  }
  static settings = settings((s) => ({ catalog: s.string("\u4E16\u754C\u8D44\u6599").default(""), debug: s.boolean("\u5F00\u53D1\u8005\u65E5\u5FD7").default(false) }));
  static test = this.method(accessor("boolean"));
  static number = this.method(accessor("number"));
  static text = this.method(accessor("string"));
  static run = this.method({
    title: "\u6267\u884C\u72B6\u6001\u89C4\u5219",
    schema: { site: str("\u8C03\u7528\u4F4D\u7F6E\u7F16\u53F7"), steps: data("\u6B65\u9AA4", []), args: data("\u672C\u6B21\u53C2\u6570", {}) },
    async run(ctx, p) {
      need(p.site, "SITE_REQUIRED", "site");
      const s = await ready(ctx, this.save);
      try {
        const result = await s.player.run(p.site, p.steps, { ...s.child.at(-1)?.args, ...p.args });
        if (s.child.length) s.child.at(-1).result = result;
        if (ctx.settings.get("debug")) console.info("\u4E16\u754C\u72B6\u6001", p.site, result);
      } catch (error) {
        if (ctx.settings.get("debug")) console.error("\u4E16\u754C\u72B6\u6001", p.site, error.code, error.message);
        throw error;
      }
    }
  });
  static finish = this.method({
    title: "\u767B\u8BB0\u672C\u6B21\u901A\u5173",
    schema: { id: str("\u901A\u5173\u8BB0\u5F55\u7F16\u53F7"), known: data("\u672C\u6B21\u5B9E\u9645\u6301\u6709", []), allowed: data("\u5141\u8BB8\u7EE7\u627F", []) },
    async run(ctx, p) {
      if (ctx.flow.isRestoring) return;
      const s = await ready(ctx, this.save), id = p.id || crypto.randomUUID();
      const selected = carryRecord(await s.rules.value(p.known), await s.rules.value(p.allowed));
      s.player.host.check();
      const previous = parse(this.save.get("finishes"), () => ({}));
      if (Object.hasOwn(previous, id)) need(JSON.stringify(previous[id]) === JSON.stringify(selected), "FINISH_EXISTS", id);
      else this.save.set("finishes", JSON.stringify({ ...previous, [id]: selected }));
      this.save.set("lastFinish", id);
    }
  });
  static inherit = this.method({
    title: "\u4ECE\u6307\u5B9A\u901A\u5173\u8BB0\u5F55\u5F00\u5C40",
    schema: { id: str("\u901A\u5173\u8BB0\u5F55\u7F16\u53F7"), ref: data("\u77E5\u8BC6\u63A5\u6536\u5BF9\u8C61", {}), field: str("\u77E5\u8BC6\u5217\u8868\u5B57\u6BB5") },
    run(ctx, p) {
      if (ctx.flow.isRestoring) return;
      const id = p.id || this.save.get("lastFinish"), records = parse(this.save.get("finishes"), () => ({}));
      need(Object.hasOwn(records, id), "FINISH_MISSING", id);
      engine(ctx, this.save).world.commit([{ kind: "set", ref: p.ref, field: p.field, value: records[id] }], "inherit/" + JSON.stringify([id, p.ref, p.field]));
    }
  });
  static remember = this.method({ title: "\u767B\u8BB0\u6C38\u4E45\u8BB0\u5F55", schema: { id: str("\u552F\u4E00\u7F16\u53F7") }, run(ctx, p) {
    if (ctx.flow.isRestoring) return;
    need(p.id, "ID_REQUIRED", "\u6C38\u4E45\u8BB0\u5F55");
    const entries = new Set(parse(this.save.get("permanent"), () => []));
    entries.add(p.id);
    this.save.set("permanent", JSON.stringify([...entries]));
  } });
  static remembered = this.method({
    title: "\u68C0\u67E5\u6C38\u4E45\u8BB0\u5F55",
    returns: { type: "boolean", label: "\u5DF2\u83B7\u5F97" },
    schema: { id: str("\u552F\u4E00\u7F16\u53F7") },
    run(ctx, p) {
      return parse(this.save.get("permanent"), () => []).includes(p.id);
    }
  });
};
function Empty() {
  return null;
}
var runtime_default = extension({ id: "world", label: "\u4E16\u754C\u72B6\u6001", autonomous: true, hidden: true })(WorldService);
export {
  runtime_default as default
};
