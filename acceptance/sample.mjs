import { emptyCatalog } from '../src/world.js';
export const ref = (id,source='world')=>({source,id});
export const field = (id,...path)=>({op:'read',ref:ref(id),path});
export const inc = (id,field,value)=>({kind:'write',operations:[{kind:'add',ref:ref(id),field,value}]});
export const obj = fields=>({op:'object',fields});
export const arg = (...path)=>({op:'arg',path});
export const say = id=>({kind:'fragment',target:{chapterId:'chapter',fragmentId:id}});
export const choose = (condition,yes,no,remember=false)=>({kind:'branch',remember,branches:[{condition,steps:yes},{steps:no}]});
export function sample(){
  return {...emptyCatalog(),types:[
    {source:'world',id:'person',fields:{hp:'number',place:'ref',known:{kind:'list',items:'text'},first:'text',wet:'boolean'},defaults:{hp:100,known:[],first:'',wet:false}},
    {source:'world',id:'place',fields:{weather:'ref'}},
    {source:'world',id:'weather',fields:{modifier:'number',rain:'boolean'}},
    {source:'world',id:'item',fields:{owner:'ref',open:'boolean',attacks:{kind:'object',fields:{heavy:'object',light:'object'}}}},
  ],objects:[
    {source:'world',id:'player',type:'person',fields:{place:ref('plaza')}},
    {source:'world',id:'plaza',type:'place',fields:{weather:ref('rain')}},
    {source:'world',id:'rain',type:'weather',fields:{modifier:-2,rain:true}},
    {source:'world',id:'umbrella',type:'item',tags:['cover'],fields:{open:true,owner:ref('player')}},
    {source:'world',id:'sword',type:'item',fields:{attacks:{light:{min:1,max:4,effect:'scratch'},heavy:{min:3,max:10,effect:'stun'}}}}
  ],rules:[{id:'raining',condition:field('player','place','weather','rain')}],
  listeners:[{id:'raincoat',tags:['weather'],event:'enter',condition:{op:'rule',id:'raining'},steps:[inc('player','hp',-1)]}],
  macros:[{id:'shop',name:'商店',target:{chapterId:'market',fragmentId:'stall'}}],
  sources:[{id:'dice',methods:[{id:'roll',inputs:{lo:{kind:'number',required:true},hi:{kind:'number',required:true}},output:'number'}]}]};
}
