// src/studio.jsx
import React3, { useEffect, useState as useState3 } from "react";
import { AutoParams, CharacterPicker as CharacterPicker2, FragmentRefPicker as FragmentRefPicker3, useDataCollection, useInspectorEnvironment, useParam, useSetting, useStorySnapshot } from "@avg-studio/studio-ui";

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
function validateFields(data, fields, where) {
  for (const [name, value] of Object.entries(data)) {
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

// src/forms.jsx
import React, { useState } from "react";
import { FragmentRefPicker } from "@avg-studio/studio-ui";
var style = { display: "grid", gap: 6, margin: "6px 0" };
function Choice({ label, value, options, change }) {
  return /* @__PURE__ */ React.createElement("label", { style }, label, /* @__PURE__ */ React.createElement("select", { value: value ?? "", onChange: (e) => change(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u8BF7\u9009\u62E9"), options.map(([v, title]) => /* @__PURE__ */ React.createElement("option", { key: v, value: v }, title))));
}
var kinds = ["number", "text", "boolean", "ref", "fragment", "list", "object", "action"];
var labels = { number: "\u6570\u503C", text: "\u6587\u672C", boolean: "\u5F00\u5173", ref: "\u5BF9\u8C61\u5F15\u7528", fragment: "\u539F\u751F\u7247\u6BB5", list: "\u5217\u8868", object: "\u7ED3\u6784", action: "\u6765\u6E90\u65B9\u6CD5" };
function Initial({ kind, value, change, catalog }) {
  if (kind === "boolean") return /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !!value, onChange: (e) => change(e.target.checked) }), " \u662F");
  if (kind === "action") return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Choice, { label: "\u7ED1\u5B9A\u6765\u6E90", value: value?.source, options: catalog.sources.map((s) => [s.id, s.name || s.id]), change: (source) => change({ source, method: "", args: {} }) }), /* @__PURE__ */ React.createElement(Choice, { label: "\u7ED1\u5B9A\u65B9\u6CD5", value: value?.method, options: (catalog.sources.find((s) => s.id === value?.source)?.methods || []).map((m) => [m.id, m.name || m.id]), change: (method) => change({ ...value, method }) }), /* @__PURE__ */ React.createElement("label", null, "\u7ED1\u5B9A\u53C2\u6570"), /* @__PURE__ */ React.createElement(JsonValue, { value: value?.args ?? {}, save: (args) => change({ ...value, args }) }));
  if (kind === "ref") return /* @__PURE__ */ React.createElement(ObjectRef, { value, change, catalog });
  if (kind === "fragment") return /* @__PURE__ */ React.createElement(FragmentRefPicker, { value, onChange: change });
  if (kind === "number" || kind === "text") return /* @__PURE__ */ React.createElement("input", { "aria-label": "\u5B57\u6BB5\u503C", type: kind === "number" ? "number" : "text", value: value ?? "", onChange: (e) => change(kind === "number" ? Number(e.target.value) : e.target.value) });
  return /* @__PURE__ */ React.createElement(JsonValue, { value: value ?? (kind === "list" ? [] : {}), save: change });
}
function JsonValue({ value, save }) {
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState("");
  return /* @__PURE__ */ React.createElement("div", { style }, /* @__PURE__ */ React.createElement("textarea", { "aria-label": "\u7ED3\u6784\u5316\u503C", value: draft ?? JSON.stringify(value, null, 2), rows: 4, onChange: (e) => setDraft(e.target.value) }), draft !== null && /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => {
    try {
      save(JSON.parse(draft));
      setDraft(null);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  } }, "\u5E94\u7528\u7ED3\u6784\u5316\u503C"), error && /* @__PURE__ */ React.createElement("small", { role: "alert" }, error));
}
function ObjectRef({ value, change, catalog }) {
  const [search, setSearch] = useState("");
  const published = catalog.sources.flatMap((source) => (source.objects || []).map((row) => ({ ...row, source: source.id })));
  const found = [...catalog.objects, ...published].filter((r) => [r.id, r.source, r.name].some((x) => x?.toLowerCase().includes(search.toLowerCase())));
  return /* @__PURE__ */ React.createElement("div", { style }, /* @__PURE__ */ React.createElement("input", { placeholder: "\u641C\u7D22\u6765\u6E90\u3001\u540D\u79F0\u6216\u7F16\u53F7", "aria-label": "\u641C\u7D22\u5BF9\u8C61", value: search, onChange: (e) => setSearch(e.target.value) }), /* @__PURE__ */ React.createElement(
    Choice,
    {
      label: "\u5BF9\u8C61",
      value: value?.id ? JSON.stringify([value.source, value.id]) : "",
      options: found.slice(0, 150).map((r) => [JSON.stringify([r.source, r.id]), (r.name || r.id) + " \xB7 " + r.source + " \xB7 " + r.id]),
      change: (v) => {
        if (v) {
          const [source, id] = JSON.parse(v);
          change({ source, id });
        }
      }
    }
  ), value?.id && /* @__PURE__ */ React.createElement("small", null, value.source, " / ", value.id));
}
function Fields({ row, put }) {
  const [name, setName] = useState(""), [kind, setKind] = useState("number");
  return /* @__PURE__ */ React.createElement("fieldset", null, /* @__PURE__ */ React.createElement("legend", null, "\u5B57\u6BB5"), Object.entries(row.fields).map(([name2, spec]) => /* @__PURE__ */ React.createElement("div", { key: name2 }, name2, " \xB7 ", labels[spec.kind ?? spec], /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => {
    const fields = { ...row.fields }, defaults = { ...row.defaults };
    delete fields[name2];
    delete defaults[name2];
    put({ fields, defaults });
  } }, "\u79FB\u9664"))), /* @__PURE__ */ React.createElement("label", { style }, "\u5B57\u6BB5\u7F16\u53F7", /* @__PURE__ */ React.createElement("input", { value: name, onChange: (e) => setName(e.target.value) })), /* @__PURE__ */ React.createElement(Choice, { label: "\u503C\u7C7B\u578B", value: kind, options: kinds.map((k) => [k, labels[k]]), change: setKind }), /* @__PURE__ */ React.createElement("button", { type: "button", disabled: !name.trim() || Object.hasOwn(row.fields, name.trim()), onClick: () => {
    put({ fields: { ...row.fields, [name.trim()]: { kind } } });
    setName("");
  } }, "\u52A0\u5165\u5B57\u6BB5"));
}
function FieldValues({ fields, values = {}, defaults, catalog, change }) {
  return /* @__PURE__ */ React.createElement("fieldset", null, /* @__PURE__ */ React.createElement("legend", null, "\u5B57\u6BB5\u503C"), Object.entries(fields).map(([name, spec]) => {
    const own = Object.hasOwn(values, name);
    const inherited = defaults && Object.hasOwn(defaults, name);
    return /* @__PURE__ */ React.createElement("div", { key: name, style }, /* @__PURE__ */ React.createElement("b", null, name), defaults && /* @__PURE__ */ React.createElement("small", null, own ? "\u6B64\u5BF9\u8C61\u7684\u521D\u503C" : inherited ? "\u6CBF\u7528\u7C7B\u578B\u9ED8\u8BA4\u503C" : "\u5C1A\u672A\u586B\u5199"), /* @__PURE__ */ React.createElement(Initial, { kind: spec.kind ?? spec, value: own ? values[name] : defaults?.[name], catalog, change: (v) => change({ ...values, [name]: v }) }), defaults && own && /* @__PURE__ */ React.createElement("button", { onClick: () => {
      const next = { ...values };
      delete next[name];
      change(next);
    } }, inherited ? "\u6062\u590D\u7C7B\u578B\u9ED8\u8BA4\u503C" : "\u6E05\u9664\u521D\u503C"));
  }));
}
function Literal({ value, change, catalog }) {
  const kind = value && Object.hasOwn(value, "fragmentId") ? "fragment" : value && typeof value === "object" && Object.hasOwn(value, "method") ? "action" : value && typeof value === "object" && Object.hasOwn(value, "source") && Object.hasOwn(value, "id") ? "ref" : Array.isArray(value) ? "list" : { number: "number", string: "text", boolean: "boolean" }[typeof value] ?? "object";
  const defaults = { text: "", number: 0, boolean: false, ref: { source: "world", id: "" }, fragment: { chapterId: "", fragmentId: "" }, list: [], object: {}, action: { source: "", method: "", args: {} } };
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Choice, { label: "\u56FA\u5B9A\u503C\u7C7B\u578B", value: kind, options: kinds.map((k) => [k, labels[k]]), change: (k) => {
    if (k) change(defaults[k]);
  } }), /* @__PURE__ */ React.createElement(Initial, { kind, value, change, catalog }));
}
function Expression({ value, change, catalog, depth = 0 }) {
  if (depth > 5) return /* @__PURE__ */ React.createElement(JsonValue, { value, save: change });
  const mode = value?.op ?? "literal";
  const modes = [["literal", "\u56FA\u5B9A\u503C"], ["arg", "\u672C\u6B21\u53C2\u6570\u6216\u524D\u4E00\u6B65\u7ED3\u679C"], ["read", "\u5BF9\u8C61\u5B57\u6BB5"], ["rule", "\u5DF2\u4FDD\u5B58\u6761\u4EF6"], ["all", "\u5168\u90E8\u6EE1\u8DB3"], ["any", "\u4EFB\u4E00\u6EE1\u8DB3"], ["not", "\u53D6\u53CD"], ["eq", "\u76F8\u7B49"], ["ne", "\u4E0D\u7B49"], ["gt", "\u5927\u4E8E"], ["ge", "\u5927\u4E8E\u7B49\u4E8E"], ["lt", "\u5C0F\u4E8E"], ["le", "\u5C0F\u4E8E\u7B49\u4E8E"], ["plus", "\u52A0"], ["minus", "\u51CF"], ["times", "\u4E58"], ["divide", "\u9664"], ["query", "\u9650\u5B9A\u8303\u56F4\u67E5\u8BE2"]];
  const nested = (v, fn) => /* @__PURE__ */ React.createElement(Expression, { value: v, change: fn, catalog, depth: depth + 1 });
  function start(op) {
    if (op === "literal") return true;
    if (op === "arg") return { op, path: [] };
    if (op === "read") return { op, ref: { source: "world", id: "" }, path: [] };
    if (op === "rule") return { op, id: "" };
    if (op === "all" || op === "any") return { op, items: [true] };
    if (op === "not") return { op, value: true };
    if (op === "query") return { op, scope: { source: "world", type: "", mode: "exists" } };
    return { op, left: 0, right: 0 };
  }
  return /* @__PURE__ */ React.createElement("fieldset", { style }, /* @__PURE__ */ React.createElement(Choice, { label: "\u53D6\u503C\u65B9\u5F0F", value: mode, options: modes, change: (s) => s && change(start(s)) }), mode === "literal" && /* @__PURE__ */ React.createElement(Literal, { value, change, catalog }), mode === "rule" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Choice, { label: "\u6761\u4EF6\u7EC4", value: value.id, options: catalog.rules.map((r) => [r.id, r.name]), change: (id) => change({ ...value, id }) }), /* @__PURE__ */ React.createElement("details", null, /* @__PURE__ */ React.createElement("summary", null, "\u4F20\u7ED9\u6761\u4EF6\u7EC4\u7684\u53C2\u6570"), /* @__PURE__ */ React.createElement(JsonValue, { value: value.args ?? { op: "arg", path: [] }, save: (args) => change({ ...value, args }) }))), mode === "read" && /* @__PURE__ */ React.createElement(ObjectRef, { catalog, value: value.ref, change: (ref) => change({ ...value, ref }) }), (mode === "read" || mode === "arg") && /* @__PURE__ */ React.createElement("label", { style }, "\u4F9D\u6B21\u7ECF\u8FC7\u7684\u5B57\u6BB5\uFF0C\u7528\u70B9\u5206\u9694", /* @__PURE__ */ React.createElement("input", { value: value.path.join("."), onChange: (e) => change({ ...value, path: e.target.value.split(".") }) })), (mode === "all" || mode === "any") && /* @__PURE__ */ React.createElement(React.Fragment, null, value.items.map((v, i) => /* @__PURE__ */ React.createElement("div", { key: i }, nested(v, (n) => change({ ...value, items: value.items.map((x, j) => i === j ? n : x) })), /* @__PURE__ */ React.createElement("button", { onClick: () => change({ ...value, items: value.items.filter((_, j) => j !== i) }) }, "\u79FB\u9664\u6B64\u9879"))), /* @__PURE__ */ React.createElement("button", { onClick: () => change({ ...value, items: [...value.items, true] }) }, "\u52A0\u5165\u6761\u4EF6")), mode === "not" && nested(value.value, (v) => change({ ...value, value: v })), value && Object.hasOwn(value, "left") && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", null, "\u5DE6\u503C"), nested(value.left, (left) => change({ ...value, left })), /* @__PURE__ */ React.createElement("label", null, "\u53F3\u503C"), nested(value.right, (right) => change({ ...value, right }))), mode === "query" && /* @__PURE__ */ React.createElement(JsonValue, { value: value.scope, save: (scope) => change({ ...value, scope }) }));
}

// src/program.jsx
import React2, { useState as useState2 } from "react";
import { AssetPicker, CharacterPicker, FragmentRefPicker as FragmentRefPicker2 } from "@avg-studio/studio-ui";
var actions = { branch: "\u6761\u4EF6\u5206\u652F", write: "\u4FEE\u6539\u72B6\u6001", spawn: "\u751F\u6210\u5B9E\u4F8B", method: "\u8C03\u7528\u6765\u6E90\u65B9\u6CD5", lines: "\u5C40\u90E8\u5BF9\u767D", macro: "\u5171\u4EAB\u6F14\u51FA", fragment: "\u539F\u751F\u7247\u6BB5", play: "\u7247\u6BB5\u5217\u8868", listen: "\u542F\u505C\u76D1\u542C", event: "\u53D1\u9001\u4E8B\u4EF6", repeat: "\u5FAA\u73AF", parallel: "\u5E76\u884C", wait: "\u7B49\u5F85\u4EFB\u52A1", cancel: "\u53D6\u6D88\u5F85\u7EED\u4EFB\u52A1", return: "\u8FD4\u56DE\u7ED3\u679C" };
var init = (kind) => ({
  branch: { kind, branches: [{ condition: true, steps: [] }, { steps: [] }], remember: false },
  write: { kind, operations: [{ kind: "set", ref: { source: "world", id: "" }, field: "", value: 0 }] },
  method: { kind, source: "", method: "", args: { op: "object", fields: {} }, as: "" },
  lines: { kind, rows: [{ text: "", speaker: "" }] },
  spawn: { kind, source: "world", count: 1, row: { type: "", fields: {} }, as: "instances" },
  macro: { kind, id: "", args: {} },
  fragment: { kind, target: { chapterId: "", fragmentId: "" } },
  play: { kind, targets: [] },
  listen: { kind, id: "", enabled: true, scope: "*" },
  event: { kind, event: "", scope: "*", args: {} },
  repeat: { kind, condition: true, steps: [] },
  parallel: { kind, join: "all", branches: [[], []] },
  wait: { kind, jobs: { op: "arg", path: ["results", "jobs"] } },
  cancel: { kind, jobs: { op: "arg", path: ["results", "jobs"] } },
  return: { kind, value: true }
})[kind];
var rowStyle = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, margin: "5px 0" };
var panel = { border: "1px solid var(--border-color,#79828255)", borderRadius: 6, padding: 9, margin: "6px 0" };
var changeAt = (a, i, v) => a.map((x, j) => i === j ? v : x);
var opts = (items) => items.map((r) => [r.id, r.name || r.id]);
function Lines({ rows, save }) {
  return /* @__PURE__ */ React2.createElement(React2.Fragment, null, rows.map((r, i) => /* @__PURE__ */ React2.createElement("div", { key: i, style: panel }, /* @__PURE__ */ React2.createElement("label", null, "\u8BF4\u8BDD\u89D2\u8272", /* @__PURE__ */ React2.createElement(CharacterPicker, { value: r.speaker || "", onChange: (speaker) => save(changeAt(rows, i, { ...r, speaker })) })), /* @__PURE__ */ React2.createElement("label", null, "\u5BF9\u767D", /* @__PURE__ */ React2.createElement("textarea", { value: r.text ?? "", onChange: (e) => save(changeAt(rows, i, { ...r, text: e.target.value })) })), /* @__PURE__ */ React2.createElement("label", null, "\u914D\u97F3", /* @__PURE__ */ React2.createElement(AssetPicker, { accepts: ["audio"], value: r.voice, onChange: (voice) => save(changeAt(rows, i, { ...r, voice })) })), /* @__PURE__ */ React2.createElement("button", { disabled: i === 0, onClick: () => save(move(rows, i, i - 1)) }, "\u4E0A\u79FB\u6B64\u53E5"), /* @__PURE__ */ React2.createElement("button", { disabled: i === rows.length - 1, onClick: () => save(move(rows, i, i + 1)) }, "\u4E0B\u79FB\u6B64\u53E5"), /* @__PURE__ */ React2.createElement("button", { onClick: () => save(rows.filter((_, j) => j !== i)) }, "\u79FB\u9664\u6B64\u53E5"))), /* @__PURE__ */ React2.createElement("button", { onClick: () => save([...rows, { text: "", speaker: "" }]) }, "\u8FFD\u52A0\u4E00\u53E5"));
}
function move(rows, from, to) {
  const next = [...rows];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
function Step({ step, set, catalog, depth }) {
  const field = (k, v) => set({ ...step, [k]: v });
  const expr = (k) => /* @__PURE__ */ React2.createElement(Expression, { value: step[k], catalog, change: (v) => field(k, v) });
  const sub = (list, save) => /* @__PURE__ */ React2.createElement(Program, { steps: list, save, catalog, depth: depth + 1 });
  switch (step.kind) {
    case "branch":
      return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("label", null, /* @__PURE__ */ React2.createElement("input", { type: "checkbox", checked: !!step.remember, onChange: (e) => field("remember", e.target.checked) }), "\u8BB0\u4F4F\u9996\u6B21\u8DEF\u7EBF"), step.branches.map((b, i) => /* @__PURE__ */ React2.createElement("fieldset", { key: i }, /* @__PURE__ */ React2.createElement("legend", null, b.condition === void 0 ? "\u5426\u5219" : "\u5982\u679C"), b.condition !== void 0 && /* @__PURE__ */ React2.createElement(Expression, { catalog, value: b.condition, change: (condition) => field("branches", changeAt(step.branches, i, { ...b, condition })) }), sub(b.steps, (steps) => field("branches", changeAt(step.branches, i, { ...b, steps }))), /* @__PURE__ */ React2.createElement("button", { onClick: () => field("branches", step.branches.filter((_, j) => j !== i)) }, "\u79FB\u9664\u5206\u652F"))), /* @__PURE__ */ React2.createElement("button", { onClick: () => {
        const a = [...step.branches], i = a.findIndex((b) => b.condition === void 0);
        a.splice(i === -1 ? a.length : i, 0, { condition: true, steps: [] });
        field("branches", a);
      } }, "\u52A0\u5165\u6761\u4EF6\u5206\u652F"), !step.branches.some((b) => b.condition === void 0) && /* @__PURE__ */ React2.createElement("button", { onClick: () => field("branches", [...step.branches, { steps: [] }]) }, "\u52A0\u5165\u5426\u5219"));
    case "write":
      return /* @__PURE__ */ React2.createElement(React2.Fragment, null, step.operations.map((op, i) => {
        const update = (patch) => field("operations", changeAt(step.operations, i, { ...op, ...patch }));
        const row = catalog.objects.find((r) => r.source === op.ref?.source && r.id === op.ref?.id);
        const fields = catalog.types.find((r) => r.source === row?.source && r.id === row?.type)?.fields || {};
        return /* @__PURE__ */ React2.createElement("div", { style: panel, key: i }, /* @__PURE__ */ React2.createElement(Choice, { label: "\u4FEE\u6539\u65B9\u5F0F", value: op.kind, options: [["set", "\u8BBE\u503C"], ["add", "\u589E\u51CF"], ["consume", "\u6D88\u8017"]], change: (kind) => update({ kind }) }), /* @__PURE__ */ React2.createElement(ObjectRef, { value: op.ref, catalog, change: (ref) => update({ ref }) }), op.kind !== "consume" && /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(Choice, { label: "\u5B57\u6BB5", value: op.field, options: Object.keys(fields).map((k) => [k, k]), change: (field2) => update({ field: field2 }) }), /* @__PURE__ */ React2.createElement(Expression, { value: op.value, change: (value) => update({ value }), catalog })), /* @__PURE__ */ React2.createElement("button", { onClick: () => field("operations", step.operations.filter((_, j) => j !== i)) }, "\u79FB\u9664\u4FEE\u6539"));
      }), /* @__PURE__ */ React2.createElement("button", { onClick: () => field("operations", [...step.operations, init("write").operations[0]]) }, "\u540C\u6279\u52A0\u5165\u4FEE\u6539"));
    case "spawn":
      return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(Choice, { label: "\u5B9E\u4F8B\u7C7B\u578B", value: JSON.stringify([step.source, step.row.type]), options: catalog.types.map((t) => [JSON.stringify([t.source, t.id]), t.name || t.id]), change: (v) => {
        if (v) {
          const [source, type] = JSON.parse(v);
          set({ ...step, source, row: { type, fields: {} } });
        }
      } }), /* @__PURE__ */ React2.createElement("label", null, "\u6570\u91CF"), expr("count"), /* @__PURE__ */ React2.createElement("label", null, "\u5B9E\u4F8B\u521D\u503C"), /* @__PURE__ */ React2.createElement(JsonValue, { value: step.row.fields, save: (fields) => field("row", { ...step.row, fields }) }));
    case "method": {
      if (step.binding !== void 0) return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("label", null, "\u4ECE\u5C5E\u6027\u53D6\u5F97\u65B9\u6CD5"), expr("binding"), /* @__PURE__ */ React2.createElement("label", null, "\u7ED3\u679C\u540D\u79F0", /* @__PURE__ */ React2.createElement("input", { value: step.as || "", onChange: (e) => field("as", e.target.value) })), /* @__PURE__ */ React2.createElement("button", { onClick: () => {
        const { binding, ...direct } = step;
        set(direct);
      } }, "\u6539\u4E3A\u76F4\u63A5\u9009\u62E9\u65B9\u6CD5"));
      const item = catalog.sources.find((r) => r.id === step.source), method = item?.methods?.find((r) => r.id === step.method);
      const fields = step.args?.fields ?? step.args ?? {};
      return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("button", { onClick: () => field("binding", { op: "read", ref: { source: "world", id: "" }, path: [] }) }, "\u4ECE\u5BF9\u8C61\u5C5E\u6027\u53D6\u5F97\u65B9\u6CD5"), /* @__PURE__ */ React2.createElement(Choice, { label: "\u6765\u6E90", value: step.source, options: opts(catalog.sources), change: (source) => set({ ...step, source, method: "", args: { op: "object", fields: {} } }) }), /* @__PURE__ */ React2.createElement(Choice, { label: "\u65B9\u6CD5", value: step.method, options: opts(item?.methods || []), change: (method2) => field("method", method2) }), Object.entries(method?.inputs || {}).map(([k, s]) => /* @__PURE__ */ React2.createElement("fieldset", { key: k }, /* @__PURE__ */ React2.createElement("legend", null, k, " \xB7 ", s.kind ?? s, " ", s.required ? "\u5FC5\u586B" : ""), /* @__PURE__ */ React2.createElement(Expression, { catalog, value: fields[k] ?? null, change: (v) => field("args", { op: "object", fields: { ...fields, [k]: v } }) }))), /* @__PURE__ */ React2.createElement("label", null, "\u7ED3\u679C\u540D\u79F0", /* @__PURE__ */ React2.createElement("input", { value: step.as || "", onChange: (e) => field("as", e.target.value) })));
    }
    case "lines":
      return /* @__PURE__ */ React2.createElement(Lines, { rows: step.rows, save: (v) => field("rows", v) });
    case "macro":
      return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(Choice, { label: "\u5171\u4EAB\u6F14\u51FA", value: step.id, options: opts(catalog.macros), change: (v) => field("id", v) }), /* @__PURE__ */ React2.createElement(JsonValue, { value: step.args ?? {}, save: (v) => field("args", v) }));
    case "fragment":
      return /* @__PURE__ */ React2.createElement(FragmentRefPicker2, { value: step.target, onChange: (v) => field("target", v) });
    case "repeat":
      return /* @__PURE__ */ React2.createElement(React2.Fragment, null, expr("condition"), sub(step.steps, (v) => field("steps", v)));
    case "parallel":
      return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(Choice, { label: "\u63A5\u4E0B\u6765\u7684\u6B65\u9AA4\u4F55\u65F6\u6267\u884C", value: step.join ?? "all", options: [["all", "\u5168\u90E8\u5B8C\u6210\u540E"], ["first", "\u9996\u9879\u5B8C\u6210\u540E"], ["none", "\u7ACB\u5373\u7EE7\u7EED"]], change: (v) => field("join", v) }), step.branches.map((b, i) => /* @__PURE__ */ React2.createElement("fieldset", { key: i }, /* @__PURE__ */ React2.createElement("legend", null, "\u5E76\u884C\u4EFB\u52A1 ", i + 1), sub(b, (v) => field("branches", changeAt(step.branches, i, v))))), /* @__PURE__ */ React2.createElement("button", { onClick: () => field("branches", [...step.branches, []]) }, "\u52A0\u5165\u4EFB\u52A1"));
    case "listen":
      return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement(Choice, { label: "\u76D1\u542C", value: step.id, options: opts(catalog.listeners), change: (v) => field("id", v) }), /* @__PURE__ */ React2.createElement("label", null, "\u4F5C\u7528\u57DF", /* @__PURE__ */ React2.createElement("input", { value: step.scope, onChange: (e) => field("scope", e.target.value) })), /* @__PURE__ */ React2.createElement("label", null, /* @__PURE__ */ React2.createElement("input", { type: "checkbox", checked: step.enabled, onChange: (e) => field("enabled", e.target.checked) }), "\u542F\u7528"));
    case "event":
      return /* @__PURE__ */ React2.createElement(React2.Fragment, null, /* @__PURE__ */ React2.createElement("label", null, "\u4E8B\u4EF6", /* @__PURE__ */ React2.createElement("input", { value: step.event, onChange: (e) => field("event", e.target.value) })), /* @__PURE__ */ React2.createElement("label", null, "\u4F5C\u7528\u57DF", /* @__PURE__ */ React2.createElement("input", { value: step.scope, onChange: (e) => field("scope", e.target.value) })), /* @__PURE__ */ React2.createElement("label", null, "\u968F\u4E8B\u4EF6\u4F20\u5165\u7684\u53C2\u6570"), /* @__PURE__ */ React2.createElement(JsonValue, { value: step.args ?? {}, save: (v) => field("args", v) }));
    case "return":
      return expr("value");
    case "cancel":
    case "wait":
      return expr("jobs");
    case "play":
      return expr("targets");
    default:
      return /* @__PURE__ */ React2.createElement(JsonValue, { value: step, save: set });
  }
}
function Program({ steps = [], save, catalog, depth = 0 }) {
  const [kind, setKind] = useState2("branch");
  if (depth > 5) return /* @__PURE__ */ React2.createElement(JsonValue, { value: steps, save });
  return /* @__PURE__ */ React2.createElement("div", null, steps.map((step, i) => /* @__PURE__ */ React2.createElement("details", { key: i, style: panel }, /* @__PURE__ */ React2.createElement("summary", null, i + 1, ". ", actions[step.kind] || step.kind, " ", step.as ? "\u2192 " + step.as : ""), /* @__PURE__ */ React2.createElement(Step, { step, catalog, set: (v) => save(changeAt(steps, i, v)), depth }), /* @__PURE__ */ React2.createElement("details", null, /* @__PURE__ */ React2.createElement("summary", null, "\u5931\u8D25\u65F6\u6267\u884C"), /* @__PURE__ */ React2.createElement(Program, { steps: step.onError ?? [], save: (items) => {
    const next = { ...step };
    if (items.length) next.onError = items;
    else delete next.onError;
    save(changeAt(steps, i, next));
  }, catalog, depth: depth + 1 })), step.kind !== "method" && /* @__PURE__ */ React2.createElement("label", null, "\u5C06\u7ED3\u679C\u4FDD\u5B58\u4E3A", /* @__PURE__ */ React2.createElement("input", { value: step.as || "", onChange: (e) => save(changeAt(steps, i, { ...step, as: e.target.value })) })), /* @__PURE__ */ React2.createElement("div", { style: rowStyle }, /* @__PURE__ */ React2.createElement("button", { disabled: i === 0, onClick: () => {
    const a = [...steps];
    [a[i - 1], a[i]] = [a[i], a[i - 1]];
    save(a);
  } }, "\u4E0A\u79FB"), /* @__PURE__ */ React2.createElement("button", { onClick: () => save(steps.filter((_, j) => j !== i)) }, "\u79FB\u9664\u8FD9\u6B65")))), /* @__PURE__ */ React2.createElement("div", { style: rowStyle }, /* @__PURE__ */ React2.createElement(Choice, { label: "\u52A8\u4F5C", value: kind, options: Object.entries(actions), change: setKind }), /* @__PURE__ */ React2.createElement("button", { onClick: () => save([...steps, init(kind)]) }, "\u52A0\u5165\u6B65\u9AA4")));
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
function authorEntries(catalog, documents) {
  const entries = [];
  for (const group of ["objects", "types", "rules", "listeners", "macros", "renderers", "sources"])
    for (const row of catalog[group] ?? []) entries.push({ group, source: row.source ?? "world", id: row.id, name: row.name ?? row.id, tags: row.tags ?? [], row });
  for (const doc of documents.map(sourceDocument)) {
    const add = (id, name, tags = []) => entries.push({ group: "external", source: doc.source, id, name: name || id, tags, row: doc });
    add(doc.source, doc.name);
    for (const method of doc.methods || []) add(method.id, method.name, ["\u65B9\u6CD5"]);
    for (const type of doc.types || []) add(type.id, type.name, ["\u7C7B\u578B"]);
    for (const [field, spec] of Object.entries(doc.authorFields || {})) add(field, spec.name, ["\u5B9A\u4E49", spec.writable ? "\u53EF\u7F16\u8F91" : "\u53EA\u8BFB"]);
    for (const row of doc.objects || []) add(row.id, row.name, row.tags);
  }
  return entries;
}
function editDefinition(document, name, value) {
  const field = document.authorFields?.[name];
  need(field?.writable === true, "READ_ONLY", document.source + "." + name);
  checkValue(value, field, document.source + "." + name);
  return { ...document.definition, [name]: value };
}

// src/inspect.js
function inspectCatalog(catalog, callSites = [], chapters) {
  const issues = [];
  const issue = (location, message) => issues.push({ location, message });
  let world;
  try {
    world = new World(catalog);
  } catch (e) {
    issue(e.location || "\u4E16\u754C\u8D44\u6599", e.message);
    return issues;
  }
  const rules = new Map(catalog.rules.map((row) => [row.id, row]));
  const methods = new Map(catalog.sources.map((source) => [source.id, new Map((source.methods || []).map((m) => [m.id, m]))]));
  const macroIds = new Set(catalog.macros.map((m) => m.id));
  const fragments = chapters && new Map(chapters.map((chapter) => [chapter.id, new Set(chapter.fragments.map((fragment) => fragment.id))]));
  function checkTarget(target, place) {
    if (target?.op) {
      infer(target, place);
      return;
    }
    if (fragments && target?.fragmentId && !fragments.get(target.chapterId)?.has(target.fragmentId)) {
      issue(place, "\u627E\u4E0D\u5230\u539F\u751F\u7247\u6BB5 " + target.fragmentId);
    }
  }
  function infer(node, place, chain = []) {
    if (!node || typeof node !== "object" || !node.op) {
      if (typeof node === "string") return "text";
      if (typeof node === "boolean") return "boolean";
      if (typeof node === "number") return "number";
      return Array.isArray(node) ? "list" : node?.fragmentId ? "fragment" : node?.source && node.id ? "ref" : "object";
    }
    if (node.op === "read" && node.ref?.source && node.ref.id && !methods.has(node.ref.source)) {
      try {
        let value = node.ref;
        if (!node.path?.length) return "object";
        for (const field of node.path) {
          if (value?.source && value?.id) {
            if (methods.has(value.source)) return;
            value = world.read(value, [field]);
          } else {
            if (value == null || !Object.hasOwn(value, field)) {
              issue(place, "\u627E\u4E0D\u5230\u5B57\u6BB5 " + field);
              return;
            }
            value = value[field];
          }
        }
        return infer(value, place);
      } catch (e) {
        issue(place, e.message);
        return;
      }
    }
    if (node.op === "rule") {
      if (!rules.has(node.id)) issue(place, "\u627E\u4E0D\u5230\u6761\u4EF6\u7EC4 " + node.id);
      else if (chain.includes(node.id)) issue(place, "\u6761\u4EF6\u7EC4\u5FAA\u73AF\u5F15\u7528 " + [...chain, node.id].join(" \u2192 "));
      else infer(rules.get(node.id).condition, place + " \u2192 " + node.id, [...chain, node.id]);
      return "boolean";
    }
    if (["all", "any"].includes(node.op)) {
      if (!Array.isArray(node.items)) {
        issue(place, "\u6761\u4EF6\u7EC4\u9700\u8981\u6210\u5458\u5217\u8868");
        return;
      }
      node.items.forEach((n, i) => infer(n, place + ".items[" + i + "]", chain));
      return "boolean";
    }
    if (node.op === "not") {
      infer(node.value, place + ".value", chain);
      return "boolean";
    }
    if ("left" in node && "right" in node) {
      const a = infer(node.left, place + ".left", chain), b = infer(node.right, place + ".right", chain);
      if (!["eq", "ne"].includes(node.op) && (a && a !== "number" || b && b !== "number")) issue(place, "\u8BE5\u8FD0\u7B97\u9700\u8981\u6570\u503C");
      return ["plus", "minus", "times", "divide"].includes(node.op) ? "number" : "boolean";
    }
    if (node.op === "object") return "object";
    if (node.op === "list") return "list";
  }
  function steps(list, place) {
    if (!Array.isArray(list)) {
      issue(place, "\u9700\u8981\u52A8\u4F5C\u5217\u8868");
      return;
    }
    list.forEach((step, i) => {
      const p = place + "[" + i + "]";
      if (step.kind === "branch") {
        if (!Array.isArray(step.branches)) return issue(p, "\u9700\u8981\u5206\u652F\u5217\u8868");
        step.branches.forEach((b, j) => {
          if ("condition" in b) infer(b.condition, p + ".branches[" + j + "].condition");
          steps(b.steps, p + ".branches[" + j + "].steps");
        });
      }
      if (step.kind === "parallel") step.branches?.forEach((b, j) => steps(b, p + ".parallel[" + j + "]"));
      if (step.kind === "repeat") {
        infer(step.condition, p + ".condition");
        steps(step.steps, p + ".steps");
      }
      if (step.kind === "return") infer(step.value, p + ".value");
      if (step.kind === "fragment") checkTarget(step.target, p + ".target");
      if (step.kind === "play") {
        if (Array.isArray(step.targets)) step.targets.forEach((target, j) => checkTarget(target, p + ".targets[" + j + "]"));
        else infer(step.targets, p + ".targets");
      }
      if (step.kind === "macro" && !macroIds.has(step.id)) issue(p, "\u627E\u4E0D\u5230\u5171\u4EAB\u6F14\u51FA " + step.id);
      if (step.kind === "method") {
        if (step.binding !== void 0) {
          infer(step.binding, p + ".binding");
          if (step.onError) steps(step.onError, p + ".onError");
          return;
        }
        const m = methods.get(step.source)?.get(step.method);
        if (!m) {
          issue(p, "\u627E\u4E0D\u5230\u6765\u6E90\u6216\u65B9\u6CD5 " + step.source + "/" + step.method);
          return;
        }
        const args = step.args?.op === "object" ? step.args.fields : step.args;
        for (const [k, spec] of Object.entries(m.inputs || {})) {
          if (!Object.hasOwn(args || {}, k)) {
            if (spec.required) issue(p + ".args." + k, "\u7F3A\u5C11\u5FC5\u586B\u8F93\u5165");
            continue;
          }
          const actual = infer(args[k], p + ".args." + k), expected = spec.kind ?? spec;
          if (actual && actual !== expected) issue(p + ".args." + k, "\u9700\u8981 " + expected + "\uFF0C\u5F53\u524D\u662F " + actual);
        }
      }
      if (step.kind === "write") for (const [j, op] of (step.operations ?? []).entries()) {
        if (!op.ref?.source || !op.ref.id || !["set", "add"].includes(op.kind)) continue;
        try {
          const row = world.get(op.ref), spec = world.types.get(JSON.stringify([row.source, row.type])).fields[op.field];
          if (!spec) throw Error("\u5B57\u6BB5\u4E0D\u5B58\u5728 " + op.field);
          if (!op.value?.op) checkValue(op.value, spec, p + ".operations[" + j + "].value");
        } catch (e) {
          issue(p + ".operations[" + j + "]", e.message);
        }
      }
      if (step.onError) steps(step.onError, p + ".onError");
    });
  }
  for (const rule of catalog.rules) infer(rule.condition, "\u6761\u4EF6\u7EC4/" + rule.id, [rule.id]);
  for (const l of catalog.listeners) {
    infer(l.condition, "\u76D1\u542C/" + l.id + ".condition");
    steps(l.steps, "\u76D1\u542C/" + l.id + ".steps");
  }
  const sites = /* @__PURE__ */ new Set();
  for (const site of callSites) {
    if (!site.id || sites.has(site.id)) issue(site.location, "\u8C03\u7528\u4F4D\u7F6E\u7F16\u53F7\u4E3A\u7A7A\u6216\u91CD\u590D");
    sites.add(site.id);
    steps(site.steps, site.location);
  }
  return issues;
}
function storyCalls(chapters) {
  const result = [];
  for (const chapter of chapters) for (const fragment of chapter.fragments) {
    let inspect = function(block) {
      if (block.type === "callExtensionFunction" && block.props?.target === "mixing-entropy.world-state/run") {
        const location = chapter.name + " / " + fragment.name + " / " + block.id;
        try {
          const params = JSON.parse(block.props.paramsJson || "{}");
          result.push({ location, id: params.site?.value, steps: params.steps?.value || [] });
        } catch {
          result.push({ location, id: null, steps: null });
        }
      }
      for (const child of block.children || []) inspect(child);
    };
    for (const block of fragment.blocks) inspect(block);
  }
  return result;
}

// src/studio.jsx
var groups = { types: "\u5BF9\u8C61\u7C7B\u578B", objects: "\u5BF9\u8C61\u4E0E\u521D\u503C", rules: "\u6761\u4EF6\u7EC4", listeners: "\u76D1\u542C", macros: "\u5171\u4EAB\u6F14\u51FA", renderers: "\u5BF9\u767D\u6A21\u677F", sources: "\u63A5\u5165\u6765\u6E90" };
var tabStyle = { display: "flex", gap: 6, flexWrap: "wrap", margin: "9px 0" };
var fieldStyle = { display: "grid", gap: 4, margin: "8px 0" };
var pretty = (v) => JSON.stringify(v, null, 2);
var fresh = (group) => {
  const id = crypto.randomUUID();
  return {
    types: { id, name: "\u65B0\u7C7B\u578B", source: "world", fields: { value: { kind: "number" } }, defaults: { value: 0 } },
    objects: { id, name: "\u65B0\u5BF9\u8C61", source: "world", type: "", tags: [], fields: {} },
    rules: { id, name: "\u65B0\u6761\u4EF6\u7EC4", condition: { op: "all", items: [] } },
    listeners: { id, name: "\u65B0\u76D1\u542C", event: "enter", tags: [], condition: true, steps: [] },
    macros: { id, name: "\u65B0\u6F14\u51FA", target: { chapterId: "", fragmentId: "" } },
    renderers: { id, name: "\u65B0\u5BF9\u767D\u6A21\u677F", speaker: "", target: { chapterId: "", fragmentId: "" } },
    sources: { id, name: "\u65B0\u6765\u6E90", methods: [] }
  }[group];
};
function Select({ label, value, onChange, values }) {
  return /* @__PURE__ */ React3.createElement("label", { style: fieldStyle }, label, /* @__PURE__ */ React3.createElement("select", { value: value || "", onChange: (e) => onChange(e.target.value) }, /* @__PURE__ */ React3.createElement("option", { value: "" }, "\u8BF7\u9009\u62E9"), values.map(([id, label2]) => /* @__PURE__ */ React3.createElement("option", { value: id, key: id }, label2))));
}
function JsonField({ name, value, onChange }) {
  const [draft, setDraft] = useState3(() => pretty(value));
  const [error, setError] = useState3("");
  useEffect(() => {
    setDraft(pretty(value));
    setError("");
  }, [value]);
  return /* @__PURE__ */ React3.createElement("label", { style: fieldStyle }, name, /* @__PURE__ */ React3.createElement("textarea", { rows: 6, spellCheck: false, value: draft ?? "", onChange: (e) => {
    const s = e.target.value;
    setDraft(s);
    try {
      const parsed = JSON.parse(s);
      setError("");
      onChange(parsed);
    } catch (e2) {
      setError(e2.message);
    }
  } }), error && /* @__PURE__ */ React3.createElement("small", { role: "alert" }, error));
}
var names = { source: "\u6765\u6E90", fields: "\u5B57\u6BB5", defaults: "\u9ED8\u8BA4\u503C", condition: "\u6761\u4EF6\u8868\u8FBE\u5F0F", tags: "\u8BCD\u6761\u7F16\u53F7", event: "\u4E8B\u4EF6", methods: "\u516C\u5F00\u65B9\u6CD5", steps: "\u52A8\u4F5C\u6B65\u9AA4" };
function WorkbenchStyle() {
  return /* @__PURE__ */ React3.createElement("style", null, `
.ws-author{color:inherit;font:inherit;line-height:1.55;padding:12px 14px;max-width:920px;container-type:inline-size}
.ws-author h2{font-size:20px;letter-spacing:.06em;margin:0 0 14px}.ws-author h3{font-size:17px}
.ws-author nav{padding:5px 0 10px;border-bottom:1px solid #81899b55}.ws-author summary{cursor:pointer;font-weight:600}
.ws-author button,.ws-author select,.ws-author input:not([type=checkbox]),.ws-author textarea{border:1px solid #78849a75;border-radius:5px;color:inherit;background:color-mix(in srgb,currentColor 5%,transparent);font:inherit;padding:5px 9px;max-width:100%}
.ws-author select option{background:Canvas;color:CanvasText}.ws-author button{cursor:pointer;min-height:30px}.ws-author button+button{margin-left:3px}
.ws-author button[aria-pressed=true],.ws-author button:hover,.ws-author summary:hover{color:#8bdac8;border-color:#69ab9d}
.ws-author button:disabled{opacity:.45;cursor:default}.ws-author small{opacity:.75}.ws-author article,.ws-author fieldset{padding:10px;border:1px solid #8993a54d;border-radius:7px}
.ws-author fieldset{margin:8px 0;min-width:0}.ws-author details{padding:6px 0}.ws-author textarea{width:100%;resize:vertical}
.ws-author label{display:block}.ws-author input::placeholder{opacity:.7;color:inherit}.ws-author [role=alert]{color:#ecad8e}
.ws-author button:focus-visible,.ws-author input:focus-visible,.ws-author select:focus-visible{outline:2px solid #6ec2af;outline-offset:2px}
`);
}
function Editor({ group, row, catalog, save, cancel }) {
  const [draft, setDraft] = useState3(() => structuredClone(row));
  const [error, setError] = useState3("");
  const put = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  return /* @__PURE__ */ React3.createElement("article", null, /* @__PURE__ */ React3.createElement("h3", null, draft.name), /* @__PURE__ */ React3.createElement("label", { style: fieldStyle }, "\u663E\u793A\u540D\u79F0", /* @__PURE__ */ React3.createElement("input", { value: draft.name, onChange: (e) => put("name", e.target.value) })), /* @__PURE__ */ React3.createElement("label", { style: fieldStyle }, "\u7A33\u5B9A\u7F16\u53F7", /* @__PURE__ */ React3.createElement("input", { value: draft.id, readOnly: true })), Object.entries(draft).filter(([k]) => !["name", "id"].includes(k)).map(([k, v]) => {
    if (k === "fields" && group === "types") return /* @__PURE__ */ React3.createElement("div", { key: k }, /* @__PURE__ */ React3.createElement(Fields, { row: draft, put: (patch) => setDraft((d) => ({ ...d, ...patch })) }), /* @__PURE__ */ React3.createElement("details", null, /* @__PURE__ */ React3.createElement("summary", null, "\u5D4C\u5957\u5B57\u6BB5\u89C4\u683C"), /* @__PURE__ */ React3.createElement(JsonValue, { value: v, save: (v2) => put(k, v2) })));
    if (k === "defaults" && group === "types") return /* @__PURE__ */ React3.createElement("div", { key: k }, /* @__PURE__ */ React3.createElement("b", null, "\u65B0\u5BF9\u8C61\u7684\u9ED8\u8BA4\u503C"), /* @__PURE__ */ React3.createElement(FieldValues, { fields: draft.fields, values: v, catalog, change: (v2) => put(k, v2) }));
    if (k === "fields" && group === "objects") {
      const type = catalog.types.find((t) => t.source === draft.source && t.id === draft.type);
      return /* @__PURE__ */ React3.createElement(FieldValues, { key: k, fields: type?.fields ?? {}, defaults: type?.defaults ?? {}, values: v, catalog, change: (v2) => put(k, v2) });
    }
    if (k === "steps") return /* @__PURE__ */ React3.createElement(Program, { key: k, steps: v, catalog, save: (steps) => put(k, steps) });
    if (k === "condition") return /* @__PURE__ */ React3.createElement(Expression, { key: k, value: v, change: (v2) => put(k, v2), catalog });
    if (k === "speaker") return /* @__PURE__ */ React3.createElement("label", { key: k, style: fieldStyle }, "\u8BF4\u8BDD\u89D2\u8272\uFF08\u7559\u7A7A\u4E3A\u65C1\u767D\uFF09", /* @__PURE__ */ React3.createElement(CharacterPicker2, { value: v, onChange: (s) => put(k, s) }));
    if (k === "target") return /* @__PURE__ */ React3.createElement(FragmentRefPicker3, { key: k, ariaLabel: "\u76EE\u6807\u7AE0\u8282\u548C\u7247\u6BB5", value: v, onChange: (ref) => put(k, ref) });
    if (k === "type") return /* @__PURE__ */ React3.createElement(Select, { key: k, label: "\u5BF9\u8C61\u7C7B\u578B", value: v, onChange: (v2) => put(k, v2), values: catalog.types.filter((t) => t.source === draft.source).map((t) => [t.id, t.name]) });
    if (typeof v === "string") return /* @__PURE__ */ React3.createElement("label", { key: k, style: fieldStyle }, names[k] ?? k, /* @__PURE__ */ React3.createElement("input", { value: v, onChange: (e) => put(k, e.target.value) }));
    return /* @__PURE__ */ React3.createElement(JsonField, { key: k, name: names[k] ?? k, value: v, onChange: (v2) => put(k, v2) });
  }), error && /* @__PURE__ */ React3.createElement("p", { role: "alert" }, error), /* @__PURE__ */ React3.createElement("div", { style: tabStyle }, /* @__PURE__ */ React3.createElement("button", { onClick: () => {
    try {
      save(draft);
    } catch (e) {
      setError(e.message);
    }
  } }, "\u4FDD\u5B58"), /* @__PURE__ */ React3.createElement("button", { onClick: cancel }, "\u53D6\u6D88")));
}
function GlobalSearch({ catalog, directory, open }) {
  const [term, setTerm] = useState3(""), [source, setSource] = useState3(""), [limit, setLimit] = useState3(50);
  const [opened, setOpened] = useState3(false);
  const rows = React3.useMemo(() => opened ? authorEntries(catalog, directory.documents.filter((r) => r.kind === "source")) : [], [opened, catalog, directory.documents]);
  const normalized = term.trim().toLowerCase(), matches = normalized || source ? rows.filter((r) => (!source || r.source === source) && [r.name, r.id, r.source, ...r.tags].some((v) => String(v ?? "").toLowerCase().includes(normalized))) : [];
  return /* @__PURE__ */ React3.createElement("details", { onToggle: (e) => setOpened(e.currentTarget.open) }, /* @__PURE__ */ React3.createElement("summary", null, "\u8DE8\u6765\u6E90\u641C\u7D22"), /* @__PURE__ */ React3.createElement("div", { style: tabStyle }, /* @__PURE__ */ React3.createElement("input", { "aria-label": "\u8DE8\u6765\u6E90\u641C\u7D22", value: term, placeholder: "\u5BF9\u8C61\u3001\u8BCD\u6761\u3001\u65B9\u6CD5\u6216\u7A33\u5B9A\u7F16\u53F7", onChange: (e) => {
    setLimit(50);
    setTerm(e.target.value);
  } }), /* @__PURE__ */ React3.createElement("select", { "aria-label": "\u9650\u5B9A\u6765\u6E90", value: source, onChange: (e) => {
    setLimit(50);
    setSource(e.target.value);
  } }, /* @__PURE__ */ React3.createElement("option", { value: "" }, "\u6240\u6709\u6765\u6E90"), [...new Set(rows.map((r) => r.source))].map((id) => /* @__PURE__ */ React3.createElement("option", { key: id }, id)))), matches.slice(0, limit).map((r, i) => /* @__PURE__ */ React3.createElement("div", { key: r.source + "/" + r.group + "/" + r.id + "/" + i }, /* @__PURE__ */ React3.createElement("button", { onClick: () => open(r) }, r.name), " ", /* @__PURE__ */ React3.createElement("small", null, r.source, " / ", r.id))), (normalized || source) && /* @__PURE__ */ React3.createElement("p", null, matches.length, " \u6761\u7ED3\u679C"), matches.length > limit && /* @__PURE__ */ React3.createElement("button", { onClick: () => setLimit(limit + 50) }, "\u663E\u793A\u66F4\u591A"));
}
function ExternalSource({ row, collection, catalog, expanded = false }) {
  const [editing, setEditing] = useState3(null), [error, setError] = useState3("");
  return /* @__PURE__ */ React3.createElement("details", { open: expanded || void 0 }, /* @__PURE__ */ React3.createElement("summary", null, row.name || row.source, " \xB7 ", row.source), (row.methods || []).map((m) => /* @__PURE__ */ React3.createElement("p", { key: m.id }, m.name || m.id, " \xB7 ", Object.keys(m.inputs || {}).join("\u3001"), " \u2192 ", m.output?.kind || m.output || "\u65E0\u8FD4\u56DE\u503C")), Object.entries(row.authorFields || {}).map(([key2, spec]) => /* @__PURE__ */ React3.createElement("div", { key: key2 }, /* @__PURE__ */ React3.createElement("b", null, spec.name || key2), " ", JSON.stringify(row.definition?.[key2]), " ", spec.writable ? /* @__PURE__ */ React3.createElement("button", { onClick: () => setEditing({ key: key2, value: row.definition?.[key2], revision: collection.revision }) }, "\u7F16\u8F91") : "\u53EA\u8BFB")), editing && /* @__PURE__ */ React3.createElement(React3.Fragment, null, /* @__PURE__ */ React3.createElement(Initial, { kind: row.authorFields[editing.key].kind, value: editing.value, catalog, change: (value) => setEditing({ ...editing, value }) }), /* @__PURE__ */ React3.createElement("button", { onClick: async () => {
    try {
      const definition = editDefinition(row, editing.key, editing.value);
      if (!await collection.updateOne(row.id, { definition: JSON.stringify(definition) }, editing.revision)) throw Error("\u6765\u6E90\u8BB0\u5F55\u4E0D\u5B58\u5728");
      setEditing(null);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  } }, "\u4FDD\u5B58\u5230\u6765\u6E90"), /* @__PURE__ */ React3.createElement("button", { onClick: () => setEditing(null) }, "\u53D6\u6D88")), error && /* @__PURE__ */ React3.createElement("p", { role: "alert" }, error));
}
function settingsPage() {
  const [encoded, setEncoded] = useSetting("world.catalog");
  const directory = useDataCollection("directory");
  const story = useStorySnapshot();
  const [issues, setIssues] = useState3(null);
  const [debug, setDebug] = useSetting("world.debug");
  const [group, setGroup] = useState3("types"), [selected, setSelected] = useState3(null), [filter, setFilter] = useState3("");
  const existing = React3.useRef(false);
  const [external, setExternal] = useState3("");
  const [page, setPage] = useState3(0);
  const pageSize = 60;
  const decoded = React3.useMemo(() => {
    try {
      return { catalog: { ...emptyCatalog(), ...JSON.parse(encoded || "{}") } };
    } catch (error) {
      return { error };
    }
  }, [encoded]);
  if (decoded.error) return /* @__PURE__ */ React3.createElement("p", { role: "alert" }, "\u4E16\u754C\u8D44\u6599\u65E0\u6CD5\u89E3\u6790\u3002", decoded.error.message);
  const catalog = decoded.catalog;
  let authorCatalog;
  try {
    authorCatalog = withDirectory(catalog, directory.documents.filter((r) => r.kind === "source"));
  } catch (e) {
    return /* @__PURE__ */ React3.createElement("p", { role: "alert" }, e.message);
  }
  const term = filter.trim().toLowerCase();
  const published = group === "sources" ? directory.documents.filter((r) => r.kind === "source" && [r.name, r.source].some((v) => v?.toLowerCase().includes(term))).map(sourceDocument) : [];
  const visible = catalog[group].filter((row) => !term || [row.name, row.source, row.id, ...row.tags || []].some((v) => v?.toLowerCase().includes(term)));
  const lastPage = Math.max(0, Math.ceil(visible.length / pageSize) - 1), currentPage = Math.min(page, lastPage);
  function apply(row) {
    const entries = [...catalog[group]];
    const i = entries.findIndex((x) => x.id === selected.id && x.source === selected.source);
    if (i >= 0 && JSON.stringify(entries[i]) !== JSON.stringify(selected)) throw Error("\u6B64\u8BB0\u5F55\u5DF2\u88AB\u5176\u4ED6\u7F16\u8F91\u4FEE\u6539\uFF0C\u53D6\u6D88\u540E\u91CD\u5F00\u4EE5\u8BFB\u53D6\u5F53\u524D\u7248\u672C");
    if (i < 0 && existing.current) throw Error("\u6B64\u8BB0\u5F55\u5DF2\u88AB\u79FB\u9664\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
    if (i < 0) entries.push(row);
    else entries[i] = row;
    const next = { ...catalog, [group]: entries };
    new World(next);
    const serialized = JSON.stringify(next);
    if (serialized !== encoded && !setEncoded(serialized)) throw Error("Studio \u672A\u63A5\u53D7\u672C\u6B21\u4FEE\u6539\uFF0C\u8349\u7A3F\u5DF2\u4FDD\u7559");
    setSelected(null);
  }
  return /* @__PURE__ */ React3.createElement("main", { className: "ws-author" }, /* @__PURE__ */ React3.createElement(WorkbenchStyle, null), /* @__PURE__ */ React3.createElement("h2", null, "\u4E16\u754C\u72B6\u6001"), /* @__PURE__ */ React3.createElement(GlobalSearch, { catalog, directory, open: (r) => {
    setPage(0);
    setFilter("");
    existing.current = true;
    setExternal(r.source);
    setGroup(r.group === "external" ? "sources" : r.group);
    setSelected(r.group === "external" ? null : r.row);
  } }), /* @__PURE__ */ React3.createElement("nav", { style: tabStyle }, Object.entries(groups).map(([key2, label]) => /* @__PURE__ */ React3.createElement("button", { "aria-pressed": group === key2, key: key2, onClick: () => {
    setGroup(key2);
    setSelected(null);
    setPage(0);
    setFilter("");
  } }, label))), /* @__PURE__ */ React3.createElement("div", { style: tabStyle }, /* @__PURE__ */ React3.createElement("input", { "aria-label": "\u641C\u7D22\u540D\u79F0\u3001\u6765\u6E90\u3001\u7F16\u53F7\u6216\u8BCD\u6761", placeholder: "\u540D\u79F0\u3001\u6765\u6E90\u3001\u7F16\u53F7\u6216\u8BCD\u6761", value: filter, onChange: (e) => {
    setPage(0);
    setFilter(e.target.value);
  } }), /* @__PURE__ */ React3.createElement("button", { onClick: () => {
    existing.current = false;
    setSelected(fresh(group));
  } }, "\u65B0\u589E", groups[group])), group === "sources" && /* @__PURE__ */ React3.createElement(React3.Fragment, null, directory.error && /* @__PURE__ */ React3.createElement("p", { role: "alert" }, directory.error.message), published.map((row) => /* @__PURE__ */ React3.createElement(ExternalSource, { key: row.id, row, collection: directory, catalog: authorCatalog, expanded: external === row.source }))), selected ? /* @__PURE__ */ React3.createElement(Editor, { key: group + selected.id, group, row: selected, catalog: authorCatalog, save: apply, cancel: () => setSelected(null) }) : /* @__PURE__ */ React3.createElement(React3.Fragment, null, /* @__PURE__ */ React3.createElement("p", null, visible.length + published.length, " \u6761"), visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((row) => /* @__PURE__ */ React3.createElement("div", { key: JSON.stringify([row.source, row.id]) }, /* @__PURE__ */ React3.createElement("button", { onClick: () => {
    existing.current = true;
    setSelected(row);
  } }, row.name || row.id), " ", /* @__PURE__ */ React3.createElement("small", null, row.source, " ", row.id))), lastPage > 0 && /* @__PURE__ */ React3.createElement("nav", { style: tabStyle, "aria-label": "\u8D44\u6599\u5206\u9875" }, /* @__PURE__ */ React3.createElement("button", { disabled: !currentPage, onClick: () => setPage(currentPage - 1) }, "\u4E0A\u4E00\u9875"), /* @__PURE__ */ React3.createElement("span", null, currentPage + 1, " / ", lastPage + 1), /* @__PURE__ */ React3.createElement("button", { disabled: currentPage >= lastPage, onClick: () => setPage(currentPage + 1) }, "\u4E0B\u4E00\u9875"))), /* @__PURE__ */ React3.createElement("label", { style: fieldStyle }, /* @__PURE__ */ React3.createElement("span", null, /* @__PURE__ */ React3.createElement("input", { type: "checkbox", checked: !!debug, onChange: (e) => setDebug(e.target.checked) }), " \u5F00\u53D1\u8005\u65E5\u5FD7")), /* @__PURE__ */ React3.createElement("button", { onClick: () => {
    try {
      setIssues(inspectCatalog(withDirectory(catalog, directory.documents.filter((r) => r.kind === "source")), storyCalls(story.chapters), story.chapters));
    } catch (e) {
      setIssues([{ location: "\u5DE5\u4F5C\u53F0", message: e.message }]);
    }
  } }, "\u68C0\u67E5\u6B64\u5DE5\u7A0B\u7684\u8C03\u7528\u5F15\u7528"), issues && /* @__PURE__ */ React3.createElement("div", { role: "status" }, issues.length ? /* @__PURE__ */ React3.createElement("ul", null, issues.map((e, i) => /* @__PURE__ */ React3.createElement("li", { key: i }, e.location, " \xB7 ", e.message))) : "\u5DF2\u6838\u5BF9\u5F53\u524D\u53EF\u9759\u6001\u5B9A\u4F4D\u7684\u5F15\u7528"));
}
function RunInspector() {
  const [site, setSite] = useParam("site"), [steps, setSteps] = useParam("steps"), [encoded] = useSetting("world.catalog");
  const { readOnly } = useInspectorEnvironment();
  const directory = useDataCollection("directory");
  let catalog = emptyCatalog(), loadError = "";
  try {
    catalog = withDirectory({ ...catalog, ...JSON.parse(encoded || "{}") }, directory.documents.filter((r) => r.kind === "source"));
  } catch (e) {
    loadError = e.message;
  }
  const [mode, setMode] = useState3("fragment"), [macro, setMacro] = useState3(""), [target, setTarget] = useState3();
  return /* @__PURE__ */ React3.createElement("section", { className: "ws-author" }, /* @__PURE__ */ React3.createElement(WorkbenchStyle, null), /* @__PURE__ */ React3.createElement("label", { style: fieldStyle }, "\u8C03\u7528\u4F4D\u7F6E\u7F16\u53F7", /* @__PURE__ */ React3.createElement("input", { value: site || "", disabled: readOnly, onChange: (e) => setSite(e.target.value) })), /* @__PURE__ */ React3.createElement("button", { disabled: readOnly, onClick: () => setSite(crypto.randomUUID()) }, site ? "\u4E3A\u590D\u5236\u7684\u8C03\u7528\u751F\u6210\u65B0\u7F16\u53F7" : "\u751F\u6210\u8C03\u7528\u7F16\u53F7"), /* @__PURE__ */ React3.createElement(Select, { label: "\u52A0\u5165\u6F14\u51FA", value: mode, onChange: setMode, values: [["fragment", "\u6B64\u5904\u7684\u7247\u6BB5"], ["macro", "\u5171\u4EAB\u6F14\u51FA"]] }), mode === "macro" ? /* @__PURE__ */ React3.createElement(Select, { label: "\u5171\u4EAB\u6F14\u51FA", value: macro, onChange: setMacro, values: catalog.macros.map((m) => [m.id, m.name]) }) : /* @__PURE__ */ React3.createElement(FragmentRefPicker3, { ariaLabel: "\u9009\u62E9\u539F\u751F\u7247\u6BB5", value: target, onChange: setTarget, disabled: readOnly }), /* @__PURE__ */ React3.createElement("button", { disabled: readOnly || (mode === "macro" ? !macro : !target?.fragmentId), onClick: () => setSteps([...steps || [], mode === "macro" ? { kind: "macro", id: macro } : { kind: "fragment", target }]) }, "\u8FFD\u52A0\u5230\u6B65\u9AA4"), loadError && /* @__PURE__ */ React3.createElement("p", { role: "alert" }, loadError), /* @__PURE__ */ React3.createElement("fieldset", { disabled: readOnly }, /* @__PURE__ */ React3.createElement("legend", null, "\u52A8\u4F5C\u7F16\u6392"), /* @__PURE__ */ React3.createElement(Program, { steps: steps ?? [], save: setSteps, catalog })), /* @__PURE__ */ React3.createElement("details", null, /* @__PURE__ */ React3.createElement("summary", null, "\u7ED3\u6784\u5316\u6B65\u9AA4\u4E0E\u8C03\u7528\u53C2\u6570"), /* @__PURE__ */ React3.createElement(AutoParams, { include: ["steps", "args"] })));
}
function ValueInspector() {
  const [node, setNode] = useParam("expression"), [encoded] = useSetting("world.catalog");
  const { readOnly } = useInspectorEnvironment();
  const directory = useDataCollection("directory");
  let catalog;
  try {
    catalog = withDirectory({ ...emptyCatalog(), ...JSON.parse(encoded || "{}") }, directory.documents.filter((r) => r.kind === "source"));
  } catch (e) {
    return /* @__PURE__ */ React3.createElement("p", { role: "alert" }, e.message);
  }
  return /* @__PURE__ */ React3.createElement("fieldset", { disabled: readOnly }, /* @__PURE__ */ React3.createElement("legend", null, "\u8BFB\u53D6\u6216\u5224\u65AD"), /* @__PURE__ */ React3.createElement(Expression, { value: node, change: setNode, catalog }), /* @__PURE__ */ React3.createElement(AutoParams, { include: ["args"] }));
}
var inspectors = { run: RunInspector, test: ValueInspector, number: ValueInspector, text: ValueInspector };
export {
  inspectors,
  settingsPage
};
