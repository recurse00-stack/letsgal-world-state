import test from 'node:test';
import assert from 'node:assert/strict';
import { World, emptySlot } from '../src/world.js';
import { Rules, carryRecord } from '../src/rules.js';
import { Player } from '../src/play.js';
import { sample, ref, field, inc, arg, obj, say, choose } from './sample.mjs';
const deep=structuredClone;
function setup(def=sample(),saved=emptySlot(),overrides={}) {
  const output=[];
  const host={check(){},restoring:()=>false,async fragment(t){output.push(t.fragmentId);},...overrides};
  const world=new World(def,deep(saved));const rules=new Rules(world,host);
  return {world,rules,player:new Player(rules,host),output};
}
test('来源命名空间、沿关系读取、精准范围与两个攻击定义',()=>{
  const def=sample();def.types.push({...def.types[2],source:'other'});def.objects.push({...def.objects[2],source:'other',fields:{rain:false,modifier:1}});
  const {world}=setup(def);
  assert.equal(world.read(ref('player'),['place','weather','modifier']),-2);
  assert.equal(world.read(ref('rain','other'),['modifier']),1);
  assert.deepEqual(world.query({tag:'cover',relation:{field:'owner',target:ref('player')},where:{open:true}}),[ref('umbrella')]);
  assert.equal(world.query({tag:'none',mode:'count'}),0);
  assert.throws(()=>world.query({source:'world',type:'item',mode:'one'}),{code:'AMBIGUOUS'});
  assert.equal(world.read(ref('sword'),['attacks','heavy','max']),10);
  assert.equal(world.read(ref('sword'),['attacks','light','effect']),'scratch');
});
test('批次原子、持久化失败及十支实例与读档',()=>{
  const {world}=setup();const create=id=>({kind:'create',ref:ref(id),row:{type:'item',fields:{owner:ref('player')}}});
  world.commit(Array.from({length:10},(_,i)=>create('arrow'+i)));
  const saved=deep(world.slot);
  assert.throws(()=>world.commit([{kind:'set',ref:ref('arrow4'),field:'open',value:true},{kind:'add',ref:ref('player'),field:'hp',value:'bad'}]),{code:'TYPE_MISMATCH'});
  assert.equal(world.get(ref('arrow4')).fields.open,undefined);
  world.commit([{kind:'set',ref:ref('arrow4'),field:'owner',value:ref('ally')}]);
  world.commit([{kind:'consume',ref:ref('arrow4')}]);
  assert.throws(()=>world.get(ref('arrow4')),{code:'CONSUMED'});assert.throws(()=>world.commit([create('arrow4')]),{code:'ID_USED'});
  assert.deepEqual(setup(sample(),saved).world.read(ref('arrow4'),['owner']),ref('player'));
  const failed=new World(sample(),emptySlot(),()=>{throw Error('disk')});
  assert.throws(()=>failed.commit(inc('player','hp',-10).operations));assert.equal(failed.read(ref('player'),['hp']),100);
});
test('相同调用点三二三，每个位置可选择首次锁定',async()=>{
  const {player,world,output}=setup();
  const step=choose(field('rain','rain'),['a','b','c'].map(say),['d','e'].map(say));
  const run=async(site,locked,values)=>{step.remember=locked;for(const v of values){world.commit([{kind:'set',ref:ref('rain'),field:'rain',value:v}]);await player.run(site,[step]);}};
  await run('gate',false,[true,false,true]); assert.deepEqual(output.splice(0),'abcdeabc'.split(''));
  await run('locked',true,[false,true]); assert.deepEqual(output.splice(0),'dede'.split(''));
  await run('separate',true,[true]); assert.deepEqual(output,'abc'.split(''));
});
test('事件按作用域分发，显式烘干；重复启用及无关事件',async()=>{
  const {rules,world}=setup();rules.enable('raincoat','hero',true);rules.enable('raincoat','hero',true);
  let count=0;const fire=()=>{count++;world.commit([{kind:'set',ref:ref('player'),field:'wet',value:true}]);};
  assert.equal(await rules.dispatch('clock','hero',{},fire),0);assert.equal(await rules.dispatch('enter','other',{},fire),0);
  assert.equal(await rules.dispatch('enter','hero',{},fire),1);assert.equal(count,1);
  rules.enable('raincoat','hero',false);assert.equal(await rules.dispatch('enter','hero',{},fire),0);assert.equal(world.read(ref('player'),['wet']),true);
  world.commit([{kind:'set',ref:ref('player'),field:'wet',value:false}]);assert.equal(world.read(ref('player'),['wet']),false);
});
test('同一取样供两步使用，交错修改同值没有丢写',async()=>{
  let draws=0;const {world,player}=setup(sample(),emptySlot(),{async request(source,method,input){assert.deepEqual(input,{lo:3,hi:10});return ++draws+4;}});
  await player.run('attack',[{kind:'method',source:'dice',method:'roll',args:obj({lo:field('sword','attacks','heavy','min'),hi:10}),as:'hit'},
    {kind:'parallel',branches:[[inc('player','hp',arg('results','hit'))],[inc('player','hp',arg('results','hit'))]]}]);
  assert.equal(draws,1);assert.equal(world.read(ref('player'),['hp']),110);
});
test('三个普通逻辑检查点可重建未完成部分，已完成动作不重放',async()=>{
  for(const route of [['a','b','c'],['line1','line2']]){
    let snapshot;
    const def=sample();const original=setup(def,emptySlot(),{async fragment(t){if(t.fragmentId===route[1]){snapshot=deep(original.world.slot);throw Error('interrupt');}}});
    const steps=[inc('player','hp',-5),...route.map(say)];
    await assert.rejects(original.player.run('route',steps));const shown=[];
    const resumed=setup(def,snapshot,{restoring:()=>true,async fragment(t){shown.push(t.fragmentId);}});
    await resumed.player.run('route',steps);
    assert.deepEqual(shown,route.slice(1));assert.equal(resumed.world.read(ref('player'),['hp']),95);
  }
});
test('共享宏与局部演出可传值，通关来源逐条隔离',async()=>{
  const def=sample();const played=[];
  const host={async fragment(target,args){played.push([target,args]);return args.coins-1;}};
  const {player}=setup(def,emptySlot(),host);
  const steps=[{kind:'macro',id:'shop',args:{coins:3},as:'remaining'},{kind:'return',value:arg('results','remaining')}];
  assert.equal(await player.run('chapter1',steps),2);assert.equal(await player.run('chapter2',steps),2);assert.equal(played[0][0].chapterId,'market');
  assert.deepEqual(carryRecord(['a','c'],['a','b']),['a']);assert.deepEqual(carryRecord(['b'],['a','b']),['b']);
});

test('并发可先续播，恢复只补未完成分支，显式等待可汇合',async()=>{
  let release,started;
  const waiting=new Promise(r=>release=r), entered=new Promise(r=>started=r);
  const observed=setup(sample(),emptySlot(),{async request(){started();await waiting;return 7;}});
  const slow={kind:'method',source:'dice',method:'roll',args:{lo:1,hi:10},as:'draw'};
  const parallel={kind:'parallel',join:'none',as:'jobs',branches:[[slow,inc('player','hp',-7)],[inc('player','hp',-3)]]};
  const steps=[parallel,say('next'),{kind:'wait',jobs:arg('results','jobs')}];
  const original=observed.player.run('p',steps);
  await entered;
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(observed.output,['next']);assert.equal(observed.world.read(ref('player'),['hp']),97);
  const snapshot=deep(observed.world.slot);
  let recovered=0;
  const resumed=setup(sample(),snapshot,{restoring:()=>true,async request(){recovered++;return 7;}});
  resumed.player.resumeJobs();
  await resumed.player.run('p',steps);
  assert.equal(recovered,1);assert.equal(resumed.world.read(ref('player'),['hp']),90);assert.deepEqual(resumed.output,[]);
  release();await original;
  assert.equal(observed.world.read(ref('player'),['hp']),90);
});
