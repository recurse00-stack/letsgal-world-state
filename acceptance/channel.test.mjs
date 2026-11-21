import test from 'node:test';
import assert from 'node:assert/strict';
import { request,serve } from '../src/channel.js';
class Collection {
  rows=new Map();listeners=new Set();id=0;
  wake(){for(const fn of this.listeners)queueMicrotask(fn);}
  async find(filter){return [...this.rows.values()].filter(row=>Object.keys(filter).every(k=>row[k]===filter[k])).map(x=>structuredClone(x));}
  async insertOne(row){const doc={...structuredClone(row),id:String(++this.id)};this.rows.set(doc.id,doc);this.wake();return doc;}
  async getById(id){return structuredClone(this.rows.get(id));}
  async updateOne(f,change){const rows=await this.find(f);if(rows.length){this.rows.set(rows[0].id,{...rows[0],...change.$set});this.wake();}}
  watch(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
}
test('两个来源回执逆序、重复通知以及恢复复用',async()=>{
  const c=new Collection(),order=[];let slow;const hold=new Promise(r=>slow=r);let draws=0;
  const stopA=serve(c,'a',async r=>{await hold;draws++;return r.args.n;});
  const stopB=serve(c,'b',async r=>r.args.n);
  const a=request(c,'a','value',{n:1},{ticket:'a1'}).then(v=>{order.push(v);return v});
  const b=request(c,'b','value',{n:2},{ticket:'b1'}).then(v=>{order.push(v);return v});
  await b;slow();await a;assert.deepEqual(order,[2,1]);assert.equal(draws,1);
  assert.equal(await request(c,'a','value',{n:1},{ticket:'a1'}),1);assert.equal(draws,1);
  await assert.rejects(request(c,'a','value',{n:2},{ticket:'a1'}),{code:'TICKET_REUSED'});
  stopA();stopB();assert.equal(c.listeners.size,0);
});
test('已发送未回执保持未知，取消解除订阅',async()=>{
  const c=new Collection();
  await assert.rejects(request(c,'offline','pay',{}, {ticket:'pay/1',timeout:15}),{code:'RECEIPT_UNKNOWN'});
  assert.equal(c.rows.size,1);assert.equal(c.listeners.size,0);
  const controller=new AbortController();
  const active=request(c,'offline','pay',{}, {ticket:'pay/1',signal:controller.signal});
  controller.abort();
  await assert.rejects(active);assert.equal(c.rows.size,1);assert.equal(c.listeners.size,0);
});
