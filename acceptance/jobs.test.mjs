import test from 'node:test';
import assert from 'node:assert/strict';
import {World,emptySlot} from '../src/world.js';
import {Rules} from '../src/rules.js';
import {Player} from '../src/play.js';
import {sample,ref,inc,arg} from './sample.mjs';
test('离场取消待续任务，迟到回执不能写入，等待者可处理取消',async()=>{
  let reply,started;
  const accepted=new Promise(resolve=>{started=resolve;});
  const external=new Promise(resolve=>{reply=resolve;});
  const host={check(){},restoring:()=>false,request:async()=>{started();return external;},fragment:()=>accepted};
  const world=new World(sample(),emptySlot()),p=new Player(new Rules(world,host),host);
  const jobs=arg('results','jobs');
  const steps=[{kind:'parallel',join:'none',as:'jobs',branches:[[{kind:'method',source:'dice',method:'roll',args:{lo:1,hi:1}},inc('player','hp',-10)]]},
    {kind:'fragment',target:{chapterId:'test',fragmentId:'leave'}},{kind:'cancel',jobs},
    {kind:'wait',jobs,onError:[{kind:'return',value:arg('error','code')}]}];
  assert.equal(await p.run('leave',steps),'CANCELLED');
  reply(1);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(world.read(ref('player'),['hp']),100);
  assert.deepEqual(world.slot.jobs,{});
});
test('来源引用的成员顺序可改变，未登记的查询来源与零匹配可区分',async()=>{
  const world=new World(sample());const rules=new Rules(world);
  assert.equal(await rules.value({op:'eq',left:{source:'a',id:'b'},right:{id:'b',source:'a'}}),true);
  assert.equal(new World().query({source:'world',tag:'伞',mode:'count'}),0);
  assert.throws(()=>world.query({source:'missing',tag:'伞'}),{code:'SOURCE_MISSING'});
});
