import { copy, equalValue, identifier, need, WorldError } from './world.js';

const operators = new Map(Object.entries({
  eq: equalValue, ne: (a,b) => !equalValue(a,b),
  gt: (a,b) => a > b, ge: (a,b) => a >= b, lt: (a,b) => a < b, le: (a,b) => a <= b,
  plus: (a,b) => a + b, minus: (a,b) => a - b, times: (a,b) => a * b, divide: (a,b) => a / b
}));
export class Rules {
  constructor(world, host = {}) {
    this.world = world;
    this.host = host;
    this.index = {};
    for (const group of ['rules','listeners','macros','sources'])
      this.index[group] = new Map(world.catalog[group].map(row => [row.id, row]));
    this.events = new Map();
    for (const listener of this.index.listeners.values()) {
      const identity=listener.watch ? this.fieldEvent(listener.watch.source,listener.watch.type,listener.watch.field) : listener.event;
      if (!this.events.has(identity)) this.events.set(identity, []);
      this.events.get(identity).push(listener);
    }
  }
  item(group, id) {
    const item = this.index[group].get(id);
    need(item, 'DEFINITION_MISSING', group + '/' + id);
    return item;
  }
  async value(node, args = {}, chain = []) {
    if (node == null || typeof node !== 'object' || !node.op) return copy(node);
    const read = x => this.value(x, args, chain);
    switch (node.op) {
      case 'arg': {
        let v = args;
        for (const part of node.path) {
          identifier(part, 'arg');
          need(v != null && Object.hasOwn(v, part), 'ARG_MISSING', node.path.join('.'));
          v = v[part];
        }
        return copy(v);
      }
      case 'read': {
        const ref = await read(node.ref);
        const path=node.path || [];
        if(!path.length) return this.index.sources.has(ref.source)
          ? this.host.request(ref.source,'read',{ref,path},args) : this.world.read(ref);
        let current=ref;
        for(const field of path){
          identifier(field,'path');
          if(current?.source && current?.id) {
            current=this.index.sources.has(current.source)
              ? await this.host.request(current.source,'read',{ref:current,path:[field]},args)
              : this.world.read(current,[field]);
          }else{
            need(current!=null && Object.hasOwn(current,field),'FIELD_MISSING',field);
            current=current[field];
          }
        }
        return copy(current);
      }
      case 'query': {
        const scope = await read(node.scope);
        const sources = scope.sources ?? [scope.source];
        if(sources.length===1&&!this.index.sources.has(sources[0]))return this.world.query({...scope,source:sources[0]});
        const lists = await Promise.all(sources.map(source => {
          const filter = {...scope,source,mode:'list'};
          delete filter.sources;
          return this.index.sources.has(source)
            ? this.host.request(source,'query',filter,args) : this.world.query(filter);
        }));
        const rows = [...new Map(lists.flat().map(ref=>[JSON.stringify([ref.source,ref.id]),ref])).values()];
        switch (scope.mode ?? 'list') {
          case 'list': return rows;
          case 'count': return rows.length;
          case 'exists': return rows.length > 0;
          case 'one': need(rows.length === 1,rows.length ? 'AMBIGUOUS' : 'NO_MATCH','query'); return rows[0];
          default: throw new WorldError('BAD_QUERY_MODE','query',scope.mode);
        }
      }
      case 'object': return Object.fromEntries(await Promise.all(Object.entries(node.fields).map(async ([k,v]) => [identifier(k,'object'),await read(v)])));
      case 'list': return Promise.all(node.items.map(read));
      case 'all': for (const n of node.items) { if (!await read(n)) return false; } return true;
      case 'any': for (const n of node.items) { if (await read(n)) return true; } return false;
      case 'not': return !await read(node.value);
      case 'rule': {
        need(!chain.includes(node.id), 'RULE_CYCLE', [...chain,node.id].join(' → '));
        return this.value(this.item('rules',node.id).condition, await read(node.args ?? args), [...chain,node.id]);
      }
      default: {
        const fn = operators.get(node.op);
        need(fn, 'UNKNOWN_EXPRESSION',node.op);
        const a = await read(node.left), b = await read(node.right);
        if (!['eq','ne'].includes(node.op)) need(Number.isFinite(a) && Number.isFinite(b),'TYPE_MISMATCH',node.op,'number');
        const result = fn(a,b);
        need(typeof result !== 'number' || Number.isFinite(result), 'NUMBER_RANGE', node.op);
        return result;
      }
    }
  }
  async choose(branches, args, memory, check = () => {}) {
    if (memory && Object.hasOwn(this.world.slot.locks, memory)) return this.world.slot.locks[memory];
    let index = -1;
    for (const [i,b] of branches.entries()) if (b.condition === undefined || await this.value(b.condition,args)) { index = i; break; }
    check();
    if (memory) this.world.update({ locks:{ ...this.world.slot.locks,[memory]:index } });
    return index;
  }
  enable(id, scope, enabled) {
    this.item('listeners',id);
    const identity = JSON.stringify([id,scope]);
    const set = new Set(this.world.slot.enabled);
    if (enabled) set.add(identity); else set.delete(identity);
    this.world.update({enabled:[...set]});
  }
  fieldEvent(source,type,field) { return JSON.stringify(['field',source,type,field]); }
  changes(pending,previous,includeAll=false) {
    const result=[];
    for(const [id,row] of pending) {
      const old=previous.get(id), identity=row ?? old;
      const fields=new Set([...Object.keys(old?.fields ?? {}),...Object.keys(row?.fields ?? {})]);
      for(const field of fields) {
        const event=this.fieldEvent(identity.source,identity.type,field);
        if(!includeAll && !this.events.has(event))continue;
        const before=old?.fields[field],after=row?.fields[field];
        if(!equalValue(before,after))result.push({
          event,ref:{source:identity.source,id:identity.id},field,before:before??null,after:after??null
        });
      }
    }
    return result;
  }
  async dispatch(event,scope,args,fire) {
    const enabled = new Set(this.world.slot.enabled);
    let checks = 0;
    for (const listener of this.events.get(event) || []) {
      if (!enabled.has(JSON.stringify([listener.id,scope])) && !enabled.has(JSON.stringify([listener.id,'*']))) continue;
      checks++;
      if (await this.value(listener.condition,args)) await fire(listener);
    }
    return checks;
  }
}
export function carryRecord(known, allowed) {
  need(Array.isArray(known)&&Array.isArray(allowed),'TYPE_MISMATCH','通关知识','list');
  const identity=v=>{
    if(typeof v==='string')return JSON.stringify(['id',identifier(v,'知识编号')]);
    need(v&&typeof v.source==='string'&&typeof v.id==='string','BAD_REFERENCE','知识编号');
    return JSON.stringify(['ref',v.source,v.id]);
  };
  const allowedIds=new Set(allowed.map(identity)),seen=new Set();
  return known.filter(item=>{const key=identity(item);if(!allowedIds.has(key)||seen.has(key))return false;seen.add(key);return true;}).map(copy);
}
export function requireMethod(catalog, source, method) {
  const owner = catalog.sources.find(row => row.id === source);
  if (!owner) throw new WorldError('SOURCE_MISSING',source);
  const spec = owner.methods?.find(row => row.id === method);
  if (!spec) throw new WorldError('METHOD_MISSING',[source,method].join('/'));
  return spec;
}
