import { copy, need, checkValue, WorldError } from './world.js';
import { requireMethod } from './rules.js';

// Frames live in the official slot. The cursor is saved before a native child starts.
export class Player {
  constructor(rules, host) {
    this.rules = rules;
    this.world = rules.world;
    this.host = host;
    this.active = [];
    this.pending = new Map();
    this.controllers = new Map();
  }
  frame(id) {
    const f = this.world.slot.calls.find(c => c.id === id) ?? this.world.slot.jobs?.[id];
    need(f, 'CALL_MISSING', id);
    return f;
  }
  checkJob(id) {
    this.host.check();
    need(!this.controllers.get(id)?.signal.aborted && this.world.slot.jobs?.[id]?.status!=='cancelled','CANCELLED',id);
  }
  patch(id, update) {
    this.checkJob(id);
    if (Object.hasOwn(this.world.slot.jobs ?? {},id)) {
      const jobs=this.world.slot.jobs, current=jobs[id];
      this.world.update({jobs:{...jobs,[id]:{...current,...update(current)}}});
      return;
    }
    this.world.update({calls:this.world.slot.calls.map(c => c.id === id ? {...c,...update(c)} : c)});
  }
  async run(site, steps, args = {}, {ticket} = {}) {
    this.host.check();
    const depth = this.active.length;
    let frame;
    const receipt=ticket ? 'external/'+ticket : null;
    if(receipt && Object.hasOwn(this.world.slot.receipts,receipt)) return copy(this.world.slot.receipts[receipt]);
    if(receipt)frame=this.world.slot.calls.find(f=>f.ticket===ticket);
    if (!frame && !ticket && this.host.restoring()) {
      frame = this.world.slot.calls.find(f => f.site === site && f.parent === (this.active.at(-1) ?? null));
      need(frame, 'RESTORE_FRAME_MISSING', site);
    } else if (!frame) {
      frame = {id:crypto.randomUUID(),site,parent:this.active.at(-1) ?? null,args:copy(args),done:{},values:{},choices:{},result:null,steps:copy(steps),...(ticket?{ticket}:{})};
      this.world.update({calls:[...this.world.slot.calls,frame]});
    }
    this.active.push(frame.id);
    try {
      await this.sequence(frame.id,frame.steps,'root');
      const result = this.frame(frame.id).result;
      this.host.check();
      const receipts={...this.world.slot.receipts};
      for(const key of Object.keys(receipts)) if(key.startsWith(frame.id+'root/'))delete receipts[key];
      if(receipt)receipts[receipt]=result;
      this.world.update({calls:this.world.slot.calls.filter(f => f.id !== frame.id),receipts});
      this.compact();
      return result;
    } finally { this.active.splice(depth,1); }
  }
  async sequence(id,steps,path,context) {
    need(Array.isArray(steps),'BAD_STEP_LIST',path);
    need(path.split('/').length<256,'RULE_DEPTH',path);
    for (const [i,step] of steps.entries()) {
      const position=path+'/'+i;
      let failure=this.frame(id).errors?.[position];
      if(!failure){
        try{await this.step(id,step,position,context);continue;}
        catch(error){
          this.checkJob(id);
          failure={code:error.code??'ACTION_FAILED',location:error.location??position,message:error.message,ticket:id+position};
          this.host.trace?.({call:id,step:position,action:step.kind,status:'failed',...failure});
          if(!Array.isArray(step.onError))throw error;
          this.patch(id,c=>({errors:{...c.errors,[position]:failure}}));
        }
      }
      await this.sequence(id,step.onError,position+'/error',{...context,error:failure});
    }
  }
  compact() {
    const jobs={...this.world.slot.jobs};
    const live=new Set(this.world.slot.calls.map(c=>c.id));
    let changed=false;
    for(const [id,job] of Object.entries(jobs)) if(job.status!=='pending' && !live.has(job.parent)) {
      delete jobs[id];changed=true;
    }
    if(changed) this.world.update({jobs});
  }
  driveJob(id) {
    const job=this.frame(id);
    if(job.status==='done') return Promise.resolve(job.result);
    if(job.status==='cancelled')return Promise.reject(new WorldError('CANCELLED',id));
    if(job.status==='failed')return Promise.reject(new WorldError(job.errorCode||'ACTION_FAILED',id,job.error));
    if(this.pending.has(id)) return this.pending.get(id);
    this.controllers.set(id,new AbortController());
    const run=Promise.resolve().then(async()=>{
      try{
        await this.sequence(id,job.steps,'work');
        const result=this.frame(id).result;
        this.patch(id,()=>({status:'done'}));this.compact();
        return result;
      }catch(error){
        this.checkJob(id);
        this.patch(id,()=>({status:'failed',error:error.message,errorCode:error.code}));
        this.host.report?.(error);
        throw error;
      }finally{this.pending.delete(id);this.controllers.delete(id);}
    });
    this.pending.set(id,run);
    return run;
  }
  resumeJobs() {
    for(const [id,job] of Object.entries(this.world.slot.jobs ?? {}))
      if(job.status==='pending') this.driveJob(id).catch(()=>{});
  }
  async step(id, step, path, context) {
    this.checkJob(id);
    const f = this.frame(id);
    if (Object.hasOwn(f.done,path)) return f.done[path];
    const args = {...f.args,...context,results:f.values};
    const value = n => this.rules.value(n,args);
    let input=f.inputs?.[path];
    if(input===undefined){
      input=await value(step.args ?? {});
      if(step.args!==undefined)this.patch(id,c=>({inputs:{...c.inputs,[path]:input}}));
    }
    let result = null;
    switch(step.kind) {
      case 'spawn': {
        const receipt=id+path;
        let created=this.world.slot.receipts[receipt];
        if(!created){
          const count=await value(step.count??1),row=await value(step.row);
          need(Number.isSafeInteger(count)&&count>=0,'BAD_COUNT',path);
          const refs=Array.from({length:count},()=>({source:step.source??'world',id:crypto.randomUUID()}));
          this.checkJob(id);
          created=this.world.commit(refs.map(ref=>({kind:'create',ref,row})),receipt,(pending,previous)=>({
            refs,changes:this.rules.changes(pending,previous,this.host.tracing?.())
          }));
        }
        for(const [i,change] of created.changes.entries()){
          const eventArgs={...args,change};
          await this.rules.dispatch(change.event,change.ref.id,eventArgs,listener=>
            this.sequence(id,listener.steps,path+'/change/'+i+'/'+listener.id,eventArgs));
        }
        result=created.refs;break;
      }
      case 'write': {
        const ops = [];
        for (const op of step.operations) ops.push({...op,ref:await value(op.ref),value:await value(op.value),row:await value(op.row)});
        this.checkJob(id);
        const changes=this.world.commit(ops,id+path,(pending,previous)=>this.rules.changes(pending,previous,this.host.tracing?.()));
        this.host.trace?.({call:id,step:path,action:'write',changes});
        for(const [i,change] of changes.entries()) {
          const scope=step.scope===undefined?change.ref.id:await value(step.scope);
          const eventArgs={...args,change};
          await this.rules.dispatch(change.event,scope,eventArgs,listener=>
            this.sequence(id,listener.steps,path+'/change/'+i+'/'+listener.id,eventArgs));
        }
        result=true;
        break;
      }
      case 'method': {
        let binding=this.frame(id).bindings?.[path];
        if(!binding){
          const descriptor=step.binding===undefined?step:await value(step.binding);
          need(descriptor&&typeof descriptor.source==='string'&&typeof descriptor.method==='string','BAD_METHOD_BINDING',path);
          binding={source:descriptor.source,method:descriptor.method,input:step.binding===undefined?input:await value(descriptor.args??{})};
          this.patch(id,c=>({bindings:{...c.bindings,[path]:binding}}));
        }
        input=binding.input;
        const spec = requireMethod(this.world.catalog,binding.source,binding.method);
        for (const [k,s] of Object.entries(spec.inputs || {})) {
          if (s.required || Object.hasOwn(input,k)) checkValue(input[k],s,path+'.'+k);
        }
        const ticket = id+path;
        this.checkJob(id);
        result = await this.host.request(binding.source,binding.method,input,{ticket,timeout:spec.timeoutMs,signal:this.controllers.get(id)?.signal});
        this.checkJob(id);
        if (spec.output) checkValue(result,spec.output,path+'.result');
        break;
      }
      case 'branch': {
        let branch = f.choices[path];
        if (branch === undefined) {
          const memory = step.remember ? JSON.stringify([f.site,path,await value(step.scope ?? null)]) : null;
          branch = await this.rules.choose(step.branches,args,memory,()=>this.checkJob(id));
          this.patch(id,c => ({choices:{...c.choices,[path]:branch}}));
        }
        this.host.trace?.({call:id,step:path,action:'branch',selected:branch});
        if (branch >= 0) await this.sequence(id,step.branches[branch].steps,path+'/'+branch,context);
        break;
      }
      case 'play':
      case 'fragment':
      case 'macro': {
        let targets=f.routes?.[path];
        if(!targets){
          const selection=step.kind==='macro' ? this.rules.item('macros',step.id).target :
            await value(step.kind==='play'?step.targets:step.target);
          targets=Array.isArray(selection)?selection:[selection];
          for(const target of targets)checkValue(target,'fragment',path);
          this.patch(id,c=>({routes:{...c.routes,[path]:targets}}));
        }
        const returns=[];
        for(const [i,target] of targets.entries()){
          const position=path+'/native/'+i;
          if(!Object.hasOwn(this.frame(id).done,position)){
            const returned=await this.host.fragment(target,input) ?? null;
            this.patch(id,c=>({done:{...c.done,[position]:returned}}));
          }
          returns.push(this.frame(id).done[position]);
        }
        result=step.kind==='play'?returns:returns[0]??null;
        break;
      }
      case 'lines': {
        let lines=f.lines?.[path];
        if(!lines){
          lines=[];
          for(const line of step.rows){
            const target=line.target??this.world.catalog.renderers?.find(r=>r.speaker===(line.speaker??''))?.target;
            checkValue(target,'fragment',path+'.target');
            const text=await value(line.text);checkValue(text,'text',path+'.text');
            lines.push({target,text,voice:line.voice??'',speaker:line.speaker??''});
          }
          this.patch(id,c=>({lines:{...c.lines,[path]:lines}}));
        }
        for(const [i,line] of lines.entries()){
          const position=path+'/line/'+i;
          if(Object.hasOwn(this.frame(id).done,position))continue;
          await this.host.line(line);
          this.patch(id,c=>({done:{...c.done,[position]:true}}));
        }
        result=lines.length;break;
      }
      case 'repeat': {
        let loop=f.loops?.[path] ?? {index:0,inside:false};
        const saveLoop=next=>this.patch(id,c=>({loops:{...c.loops,[path]:next}}));
        while(loop.inside || await value(step.condition)){
          this.host.check();
          if(step.limit!==undefined)need(loop.index<step.limit,'REPEAT_LIMIT',path);
          if(!loop.inside){loop={...loop,inside:true};saveLoop(loop);}
          await this.sequence(id,step.steps,path+'/turn/'+loop.index,context);
          loop={index:loop.index+1,inside:false};saveLoop(loop);
          if(loop.index%64===0)await new Promise(resolve=>setTimeout(resolve,0));
        }
        result=loop.index;break;
      }
      case 'parallel': {
        const background=action=>['write','spawn','method','return'].includes(action.kind)||
          (action.kind==='branch'&&action.branches.every(branch=>branch.steps.every(background)))||
          (action.kind==='repeat'&&action.steps.every(background));
        need(step.branches.every(branch=>branch.every(background)), 'PARALLEL_INTERACTIVE',path);
        const join=step.join ?? 'all';
        need(['all','first','none'].includes(join),'BAD_JOIN',path);
        const jobs={...this.world.slot.jobs}, ids=[];
        for(const [i,branch] of step.branches.entries()){
          const child=id+path+'/parallel/'+i;ids.push(child);
          if(!jobs[child]) jobs[child]={id:child,parent:id,site:f.site,args:copy(args),steps:copy(branch),
            status:'pending',choices:{},done:{},values:copy(f.values),result:null};
        }
        this.world.update({jobs});
        const work=ids.map(child=>this.driveJob(child));
        for(const item of work)item.catch(()=>{});
        if(join==='first' && work.length)await Promise.race(work);
        if(join==='all') {
          const outcomes=await Promise.allSettled(work);
          const failure=outcomes.find(item=>item.status==='rejected');
          if(failure)throw failure.reason;
        }
        result=ids;
        break;
      }
      case 'cancel': {
        const ids=await value(step.jobs);
        need(Array.isArray(ids),'TYPE_MISMATCH',path,'list');
        const jobs={...this.world.slot.jobs};
        for(const child of ids){
          need(Object.hasOwn(jobs,child),'JOB_MISSING',child);
          if(jobs[child].status==='pending')jobs[child]={...jobs[child],status:'cancelled'};
        }
        this.world.update({jobs});
        for(const child of ids)if(jobs[child].status==='cancelled')this.controllers.get(child)?.abort();
        result=ids;
        break;
      }
      case 'wait': result=await Promise.all((await value(step.jobs)).map(job=>this.driveJob(job))); break;
      case 'listen': this.rules.enable(step.id,await value(step.scope),step.enabled); break;
      case 'event': result = await this.rules.dispatch(step.event,await value(step.scope),input,
        listener=>this.sequence(id,listener.steps,path+'/'+listener.id,input)); break;
      case 'return': result = await value(step.value); this.patch(id,()=>({result})); break;
      default: need(false,'BAD_STEP',path,step.kind);
    }
    this.patch(id,c=>({done:{...c.done,[path]:result},values:step.as ? {...c.values,[step.as]:result} : c.values}));
    this.host.trace?.({call:id,step:path,action:step.kind,status:'done',result});
    return result;
  }
}
