import test from 'node:test';
import assert from 'node:assert/strict';
import {World,emptySlot} from '../src/world.js';
import {Player} from '../src/play.js';
import {Rules} from '../src/rules.js';
import {inspectCatalog,storyCalls} from '../src/inspect.js';
import {withDirectory,editDefinition} from '../src/sources.js';
import {sample,arg,ref,field,choose,inc} from './sample.mjs';
const setup=(catalog=sample(),saved=emptySlot(),over={})=>{
  const host={check(){},restoring:()=>false,...over};
  const world=new World(catalog,structuredClone(saved));const rules=new Rules(world,host);
  return {world,rules,player:new Player(rules,host)};
};
test('方法保存在属性中，查看资料不取样，单次使用返回值可重复读取',async()=>{
  let calls=0;const catalog=sample(),type=catalog.types.at(-1);
  type.fields.bind={kind:'action'};catalog.objects.at(-1).fields.bind={source:'dice',method:'roll',args:{op:'object',fields:{lo:field('sword','attacks','heavy','min'),hi:field('sword','attacks','heavy','max')}}};
  const {world,player}=setup(catalog,emptySlot(),{request:async(s,m,params)=>{assert.deepEqual(params,{lo:3,hi:10});return ++calls+5;}});
  assert.equal(world.read(ref('sword'),['bind']).method,'roll');assert.equal(calls,0);
  await player.run('attack',[{kind:'method',binding:field('sword','bind'),as:'damage'},inc('player','hp',arg('results','damage')),inc('player','hp',arg('results','damage'))]);
  assert.equal(calls,1);assert.equal(world.read(ref('player'),['hp']),112);
});
test('宝箱在触发时才生成物品，转移和消耗同一编号，另一新箭得到新的编号',async()=>{
  const {world,player}=setup();
  const make=n=>[{kind:'spawn',count:n,row:{type:'item',tags:['arrow'],fields:{owner:ref('player')}},as:'created'},{kind:'return',value:arg('results','created')}];
  assert.equal(world.query({tag:'arrow',mode:'count'}),0);const ten=await player.run('open',make(10));
  assert.equal(new Set(ten.map(r=>r.id)).size,10);const saved=structuredClone(world.slot);
  world.commit([{kind:'set',ref:ten[3],field:'owner',value:ref('ally')}]);
  assert.equal(world.query({tag:'arrow',relation:{field:'owner',target:ref('player')},mode:'count'}),9);
  world.commit([{kind:'consume',ref:ten[3]}]);const [next]=await player.run('again',make(1));
  assert.ok(!ten.some(r=>r.id===next.id));assert.throws(()=>world.get(ten[3]),{code:'CONSUMED'});
  assert.deepEqual(setup(sample(),saved).world.read(ten[3],['owner']),ref('player'));
});
test('属性通知只检查匹配监听，收伞时检查与下次遇到时检查可以区分',async()=>{
  const def=sample(),rain={op:'all',items:[{op:'rule',id:'raining'},{op:'not',value:field('umbrella','open')}]};
  const wet={kind:'write',operations:[{kind:'set',ref:ref('player'),field:'wet',value:true}]};
  def.listeners.push({id:'umbrella-changed',watch:{source:'world',type:'item',field:'open'},condition:rain,steps:[wet]});
  const {world,player,rules}=setup(def);
  const toggle=val=>({kind:'write',operations:[{kind:'set',ref:ref('umbrella'),field:'open',value:val}]});
  await player.run('once',[toggle(false),toggle(true)]);assert.equal(world.read(ref('player'),['wet']),false);
  rules.enable('umbrella-changed','umbrella',true);
  await player.run('again',[toggle(false),toggle(true)]);assert.equal(world.read(ref('player'),['wet']),true);
  assert.equal(await rules.dispatch('irrelevant','umbrella',{},()=>assert.fail()),0);
});
test('局部台词恢复精确到角色和行，原始实参在续播期间保持',async()=>{
  const def=sample(),t={chapterId:'c',fragmentId:'n'};def.renderers=[{speaker:'',target:t},{speaker:'乙',target:{...t,fragmentId:'speaker'}}];
  const lines=[{kind:'lines',rows:[{text:'第一句'},{text:arg('text'),speaker:'乙',voice:'clips/two.wav'}]}];
  let saved;const original=setup(def,emptySlot(),{line:async l=>{if(l.speaker){saved=structuredClone(original.world.slot);throw Error('退出');}}});
  await assert.rejects(original.player.run('gate',lines,{text:'第二句'}));const seen=[];
  const next=setup(def,saved,{restoring:()=>true,line:async l=>seen.push(l)});
  await next.player.run('gate',lines,{text:'已经变化'});
  assert.deepEqual(seen,[{target:{chapterId:'c',fragmentId:'speaker'},text:'第二句',speaker:'乙',voice:'clips/two.wav'}]);
});
test('检查坏引用、来源参数类型、条件循环；外部定义保留唯一权威',()=>{
  const def=sample();def.rules.push({id:'self',condition:{op:'rule',id:'self'}});
  const problems=inspectCatalog(def,[{id:'x',location:'甲/门',steps:[{kind:'method',source:'dice',method:'roll',args:{lo:'错',hi:4}},{kind:'macro',id:'removed'}]}]);
  assert.ok(problems.some(p=>p.location.includes('甲/门')&&p.message.includes('需要 number')));assert.ok(problems.some(p=>p.message.includes('循环')));assert.ok(problems.some(p=>p.message.includes('removed')));
  const doc={id:'row',kind:'source',source:'gear',name:'装备',methods:[],authorFields:{tag:{kind:'text',writable:true},id:{kind:'text'}},definition:{tag:'cover',id:'gear'}};
  assert.equal(withDirectory(def,[doc]).sources.at(-1).id,'gear');assert.deepEqual(editDefinition(doc,'tag','rain'),{tag:'rain',id:'gear'});assert.throws(()=>editDefinition(doc,'id','other'),{code:'READ_ONLY'});
});
test('能定位失效的片段和对象，跨到接入方的字段留待该来源读取',()=>{
  const catalog=sample(),chapters=[{id:'c',fragments:[{id:'valid'}]}];
  catalog.objects.find(r=>r.id==='player').fields.place={source:'dice',id:'external-place'};
  const calls=[{id:'x',location:'城门',steps:[
    {kind:'fragment',target:{chapterId:'c',fragmentId:'valid'}},
    {kind:'play',targets:[{chapterId:'c',fragmentId:'removed'}]},
    {kind:'return',value:field('missing','hp')},
    {kind:'return',value:field('player','place','weather','modifier')}
  ]}];
  const issues=inspectCatalog(catalog,calls,chapters);
  assert.deepEqual(issues.map(row=>row.location),['城门[1].targets[0]','城门[2].value']);
  assert.match(issues[0].message,/removed/);assert.match(issues[1].message,/missing/);
});
test('改字段类型后指出剧情块与参数，换回同类型字段后解除诊断',()=>{
  const catalog=sample(),weather=catalog.types.find(type=>type.id==='weather');
  const row=catalog.objects.find(obj=>obj.id==='rain');
  const params={site:{kind:'lit',value:'weather-roll'},steps:{kind:'lit',value:[
    {kind:'method',source:'dice',method:'roll',args:{lo:field('rain','modifier'),hi:10}}
  ]}};
  const chapters=[{name:'城门',fragments:[{name:'检查天气',blocks:[{id:'取样调用',type:'callExtensionFunction',props:{
    target:'mixing-entropy.world-state/run',paramsJson:JSON.stringify(params)
  }}]}]}];
  const sites=storyCalls(chapters);
  assert.deepEqual(inspectCatalog(catalog,sites),[]);
  weather.fields.modifier='text';row.fields.modifier='暴雨';
  const [bad]=inspectCatalog(catalog,sites);
  assert.equal(bad.location,'城门 / 检查天气 / 取样调用[0].args.lo');
  assert.match(bad.message,/number.*text/);
  weather.fields.numericModifier='number';row.fields.numericModifier=-2;
  sites[0].steps[0].args.lo=field('rain','numericModifier');
  assert.deepEqual(inspectCatalog(catalog,sites),[]);
});
test('作者决定展示、点击和执行分别检查；撤销时刻给出四种不同的处理',async()=>{
  for(const checkAt of [['show'],['click'],['act'],['show','act']])for(const revokeAt of ['beforeClick','afterClick']){
    const {world,player}=setup();const checks=[];let allowed=true;
    const doCheck=async phase=>{if(checkAt.includes(phase)){checks.push(phase);allowed=await player.run('check-'+phase,[{kind:'return',value:field('umbrella','open')}]);}};
    const revoke=()=>world.commit([{kind:'set',ref:ref('umbrella'),field:'open',value:false}]);
    await doCheck('show');if(revokeAt==='beforeClick')revoke();
    await doCheck('click');if(revokeAt==='afterClick')revoke();
    await doCheck('act');
    assert.deepEqual(checks,checkAt);
    assert.equal(allowed,!checkAt.includes('act')&&(!checkAt.includes('click')||revokeAt==='afterClick'));
  }
});
