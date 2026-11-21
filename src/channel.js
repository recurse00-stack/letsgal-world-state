import { equalValue, need, WorldError } from './world.js';

// Applications keep their own facts. This archive collection contains only calls and replies.
export async function request(collection, source, method, args, { ticket = crypto.randomUUID(), signal, timeout = 10000 } = {}) {
  signal?.throwIfAborted();
  const lookup = async () => (await collection.find({ ticket,source,method },{ limit:1 }))[0];
  const prior = await lookup();
  if (prior) need(equalValue(prior.args,args),'TICKET_REUSED',ticket);
  const row = prior || await collection.insertOne({ticket,source,method,args,status:'pending'});
  return new Promise((resolve,reject) => {
    let stop = () => {};
    let timer;
    let settled = false;
    const finish = (fn,value) => {
      if (settled) return;
      settled = true;
      stop();
      clearTimeout(timer);
      signal?.removeEventListener('abort',aborted);
      fn(value);
    };
    const aborted = () => finish(reject,new WorldError('CANCELLED',ticket));
    const inspect = async () => {
      try {
        const current = await collection.getById(row.id);
        if (!current) return finish(reject,new WorldError('REQUEST_MISSING',ticket));
        if (current.status === 'done') finish(resolve,current.result);
        if (current.status === 'failed') finish(reject,new WorldError('PROVIDER_FAILED',ticket,current.reason));
      } catch (err) { finish(reject,err); }
    };
    stop = collection.watch(inspect);
    signal?.addEventListener('abort',aborted,{once:true});
    timer = setTimeout(()=>finish(reject,new WorldError('RECEIPT_UNKNOWN',ticket)),timeout);
    if (signal?.aborted) aborted(); else void inspect();
  });
}
// A provider must commit effects and ticket in one owner transaction before returning.
export function serve(collection, source, execute, onError = console.error) {
  const active = new Set();
  let closed = false;
  const pump = async () => {
    const rows = await collection.find({source,status:'pending'});
    await Promise.all(rows.map(async row => {
      if (closed || active.has(row.id)) return;
      active.add(row.id);
      try {
        let reply;
        try { reply = {status:'done',result:await execute(row)}; }
        catch (e) { reply = {status:'failed',reason:String(e.message || e)}; }
        if (!closed) await collection.updateOne({id:row.id,status:'pending'},{$set:reply});
      } finally { active.delete(row.id); }
    }));
  };
  const wake = () => { if (!closed) void pump().catch(onError); };
  const stop = collection.watch(wake);
  wake();
  return () => { closed = true; stop(); };
}
