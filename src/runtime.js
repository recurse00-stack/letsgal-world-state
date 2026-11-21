import { Extension, extension, defineSave, settings } from '@avg-studio/sdk';
import { need, World, emptyCatalog, emptySlot } from './world.js';
import { Rules, carryRecord } from './rules.js';
import { Player } from './play.js';
import { request, serve } from './channel.js';
import { withDirectory } from './sources.js';
import manifest from '../extension.json';

const localState = new WeakMap();
const providers = new WeakMap();
const parse = (s, defaults) => s ? JSON.parse(s) : defaults();
const data = (label, value) => ({type:'data',label,default:value});
const str = label => ({type:'string',label,default:''});
function engine(ctx,save) {
  const raw = save.get('state');
  const definitions = ctx.settings.get('catalog') || '';
  const signal = ctx.flow.signal;
  let svc = localState.get(ctx.flow);
  if (svc && svc.raw === raw && svc.definitions === definitions && svc.signal === signal) return svc;
  svc = {raw,definitions,signal,child:[]};
  const check = () => {
    signal.throwIfAborted();
    need(localState.get(ctx.flow) === svc,'STALE_RUN','world');
  };
  const world = new World(parse(definitions,emptyCatalog),parse(raw,emptySlot),next => {
    check();
    const encoded = JSON.stringify(next);
    save.set('state',encoded);
    svc.raw = encoded;
  });
  const host = {check,restoring:()=>ctx.flow.isRestoring,tracing:()=>!!ctx.settings.get('debug'),
    trace:entry=>{if(ctx.settings.get('debug'))console.info('世界状态步骤',JSON.stringify(entry));},
    report:error=>{if(ctx.settings.get('debug'))console.info('世界状态并行任务结果',error.code||'ACTION_FAILED',error.message);},
    request:(source,method,args,meta) => request(ctx.database.collection('calls'),source,method,args,{
      ticket:meta?.ticket,timeout:meta?.timeout,signal:meta?.signal ? AbortSignal.any([signal,meta.signal]) : signal
    }),
    async line(row) {
      check();
      if(save.get('lineText')!==row.text)save.set('lineText',row.text);
      if(row.voice && !ctx.flow.isRestoring)await ctx.sound.play(row.voice,{type:'VOCAL'});
      await host.fragment(row.target,{speaker:row.speaker,text:row.text});
    },
    async fragment(target,args) {
      need(!ctx.performance.isActive(),'PERFORMANCE_ACTIVE',target?.fragmentId);
      const chapter = await ctx.story.getChapter(target?.chapterId);
      const fragment=chapter?.fragments?.find(f=>f.id===target.fragmentId);
      need(fragment,'FRAGMENT_MISSING',JSON.stringify(target));
      need(!chapter.disabled && !fragment.disabled,'FRAGMENT_DISABLED',JSON.stringify(target));
      check();
      svc.child.push({args,result:null});
      try {
        await ctx.flow.callFragment(target.fragmentId,{chapterId:target.chapterId});
        check();
        return svc.child.at(-1).result;
      } finally { svc.child.pop(); }
    }};
  svc.world = world;
  svc.rules = new Rules(world,host);
  svc.player = new Player(svc.rules,host);
  localState.set(ctx.flow,svc);
  return svc;
}
async function ready(ctx,save) {
  const s=engine(ctx,save);
  if(!s.directoryLoad) {
    s.directoryLoad=ctx.database.collection('directory').find({kind:'source'}).then(rows=>{
      s.player.host.check();
      const full=withDirectory(s.world.catalog,rows);
      s.world.catalog=full;
      s.rules.index.sources=new Map(full.sources.map(source=>[source.id,source]));
      s.player.resumeJobs();
    }).catch(err=>{s.directoryLoad=null;throw err;});
  }
  await s.directoryLoad;
  return s;
}
const schema = defineSave({
  lineText:{type:'string',default:'',persistence:'slot',label:'当前原位对白正文'},
  state:{type:'string',default:'',persistence:'slot',label:'当前周目'},
  finishes:{type:'string',default:'',persistence:'shared',label:'通关时允许继承的知识'},
  lastFinish:{type:'string',default:'',persistence:'shared',label:'最近一次登记的通关编号'},
  permanent:{type:'string',default:'',persistence:'shared',label:'永久记录'}
});
function accessor(kind) {
  return {title:{boolean:'检查条件',number:'读取数值',string:'读取文本'}[kind],
    returns:{type:kind,label:'结果'},schema:{expression:data('取值或条件',true),args:data('本次参数',{})},
    async run(ctx,p) {
      const s = await ready(ctx,this.save);
      const v = await s.rules.value(p.expression,{...s.child.at(-1)?.args,...p.args});
      need(typeof v === kind,'TYPE_MISMATCH','result',kind);
      return v;
    }};
}
class WorldService extends Extension.withSave(schema) {
  static onRegister(ctx) {
    // The official variable bridge addresses the same declared save fields from a registration hook.
    const save={get:key=>ctx.variables.get(manifest.id+'.'+key),set:(key,value)=>ctx.variables.set(manifest.id+'.'+key,value)};
    providers.get(ctx.flow)?.();
    const stop = serve(ctx.database.collection('calls'),'world',async row => {
      const s = await ready(ctx,save), p = row.args;
      if (row.method === 'read') return s.world.read(p.ref,p.path);
      if (row.method === 'query') return s.world.query(p);
      if (row.method === 'write') {
        const worker=new Player(s.rules,s.player.host);
        return worker.run('world/write',[{kind:'write',operations:p.operations,scope:p.scope},{kind:'return',value:true}],{}, {ticket:row.ticket});
      }
      if (row.method === 'check') return s.rules.value(p.expression,p.args);
      throw Error('METHOD_MISSING · world/'+row.method);
    });
    providers.set(ctx.flow, stop);
  }
  onInit() { void ready(this.context,this.save).catch(e=>{if(this.context.settings.get('debug'))console.error('世界状态',e.message);}); }
  render() { return {component:Empty,props:{}}; }
  static settings = settings(s=>({catalog:s.string('世界资料').default(''),debug:s.boolean('开发者日志').default(false)}));
  static test = this.method(accessor('boolean'));
  static number = this.method(accessor('number'));
  static text = this.method(accessor('string'));
  static run = this.method({title:'执行状态规则',schema:{site:str('调用位置编号'),steps:data('步骤',[]),args:data('本次参数',{})},
    async run(ctx,p) {
      need(p.site,'SITE_REQUIRED','site');
      const s = await ready(ctx,this.save);
      try {
        const result = await s.player.run(p.site,p.steps,{...s.child.at(-1)?.args,...p.args});
        if (s.child.length) s.child.at(-1).result = result;
        if (ctx.settings.get('debug')) console.info('世界状态',p.site,result);
      } catch (error) {
        if (ctx.settings.get('debug')) console.error('世界状态',p.site,error.code,error.message);
        throw error;
      }
    }});
  static finish = this.method({title:'登记本次通关',schema:{id:str('通关记录编号'),known:data('本次实际持有',[]),allowed:data('允许继承',[])},
    async run(ctx,p){
      if(ctx.flow.isRestoring)return;
      const s=await ready(ctx,this.save),id=p.id||crypto.randomUUID();
      const selected=carryRecord(await s.rules.value(p.known),await s.rules.value(p.allowed));
      s.player.host.check();
      const previous=parse(this.save.get('finishes'),()=>({}));
      if(Object.hasOwn(previous,id))need(JSON.stringify(previous[id])===JSON.stringify(selected),'FINISH_EXISTS',id);
      else this.save.set('finishes',JSON.stringify({...previous,[id]:selected}));
      this.save.set('lastFinish',id);
    }});
  static inherit = this.method({title:'从指定通关记录开局',schema:{id:str('通关记录编号'),ref:data('知识接收对象',{}),field:str('知识列表字段')},
    run(ctx,p){if(ctx.flow.isRestoring)return;
      const id=p.id||this.save.get('lastFinish'),records=parse(this.save.get('finishes'),()=>({}));
      need(Object.hasOwn(records,id),'FINISH_MISSING',id);
      engine(ctx,this.save).world.commit([{kind:'set',ref:p.ref,field:p.field,value:records[id]}],'inherit/'+JSON.stringify([id,p.ref,p.field])); }});
  static remember = this.method({title:'登记永久记录',schema:{id:str('唯一编号')},run(ctx,p){
    if(ctx.flow.isRestoring)return; need(p.id,'ID_REQUIRED','永久记录');
    const entries=new Set(parse(this.save.get('permanent'),()=>[])); entries.add(p.id); this.save.set('permanent',JSON.stringify([...entries])); }});
  static remembered = this.method({title:'检查永久记录',returns:{type:'boolean',label:'已获得'},schema:{id:str('唯一编号')},
    run(ctx,p){return parse(this.save.get('permanent'),()=>[]).includes(p.id);}});
}
function Empty() { return null; }
export default extension({id:'world',label:'世界状态',autonomous:true,hidden:true})(WorldService);
