import React,{useState} from 'react';
import {AssetPicker,CharacterPicker,FragmentRefPicker} from '@avg-studio/studio-ui';
import {Choice,Expression,JsonValue,ObjectRef} from './forms.jsx';

const actions={branch:'条件分支',write:'修改状态',spawn:'生成实例',method:'调用来源方法',lines:'局部对白',macro:'共享演出',fragment:'原生片段',play:'片段列表',listen:'启停监听',event:'发送事件',repeat:'循环',parallel:'并行',wait:'等待任务',cancel:'取消待续任务',return:'返回结果'};
const init=kind=>({
  branch:{kind,branches:[{condition:true,steps:[]},{steps:[]}],remember:false},write:{kind,operations:[{kind:'set',ref:{source:'world',id:''},field:'',value:0}]},
  method:{kind,source:'',method:'',args:{op:'object',fields:{}},as:''},lines:{kind,rows:[{text:'',speaker:''}]},
  spawn:{kind,source:'world',count:1,row:{type:'',fields:{}},as:'instances'},
  macro:{kind,id:'',args:{}},fragment:{kind,target:{chapterId:'',fragmentId:''}},play:{kind,targets:[]},
  listen:{kind,id:'',enabled:true,scope:'*'},event:{kind,event:'',scope:'*',args:{}},repeat:{kind,condition:true,steps:[]},
  parallel:{kind,join:'all',branches:[[],[]]},wait:{kind,jobs:{op:'arg',path:['results','jobs']}},cancel:{kind,jobs:{op:'arg',path:['results','jobs']}},return:{kind,value:true}
})[kind];
const rowStyle={display:'flex',flexWrap:'wrap',alignItems:'center',gap:5,margin:'5px 0'};
const panel={border:'1px solid var(--border-color,#79828255)',borderRadius:6,padding:9,margin:'6px 0'};
const changeAt=(a,i,v)=>a.map((x,j)=>i===j?v:x);
const opts=items=>items.map(r=>[r.id,r.name||r.id]);
function Lines({rows,save}){return <>{rows.map((r,i)=><div key={i} style={panel}><label>说话角色<CharacterPicker value={r.speaker||''} onChange={speaker=>save(changeAt(rows,i,{...r,speaker}))}/></label>
  <label>对白<textarea value={r.text??''} onChange={e=>save(changeAt(rows,i,{...r,text:e.target.value}))}/></label>
  <label>配音<AssetPicker accepts={['audio']} value={r.voice} onChange={voice=>save(changeAt(rows,i,{...r,voice}))}/></label>
  <button disabled={i===0} onClick={()=>save(move(rows,i,i-1))}>上移此句</button>
  <button disabled={i===rows.length-1} onClick={()=>save(move(rows,i,i+1))}>下移此句</button>
  <button onClick={()=>save(rows.filter((_,j)=>j!==i))}>移除此句</button></div>)}<button onClick={()=>save([...rows,{text:'',speaker:''}])}>追加一句</button></>;}
function move(rows,from,to){const next=[...rows];next.splice(to,0,next.splice(from,1)[0]);return next;}
function Step({step,set,catalog,depth}){
  const field=(k,v)=>set({...step,[k]:v});
  const expr=(k)=><Expression value={step[k]} catalog={catalog} change={v=>field(k,v)}/>;
  const sub=(list,save)=><Program steps={list} save={save} catalog={catalog} depth={depth+1}/>;
  switch(step.kind){
    case 'branch': return <><label><input type="checkbox" checked={!!step.remember} onChange={e=>field('remember',e.target.checked)}/>记住首次路线</label>
      {step.branches.map((b,i)=><fieldset key={i}><legend>{b.condition===undefined?'否则':'如果'}</legend>
        {b.condition!==undefined&&<Expression catalog={catalog} value={b.condition} change={condition=>field('branches',changeAt(step.branches,i,{...b,condition}))}/>}
        {sub(b.steps,steps=>field('branches',changeAt(step.branches,i,{...b,steps})))}
        <button onClick={()=>field('branches',step.branches.filter((_,j)=>j!==i))}>移除分支</button></fieldset>)}
      <button onClick={()=>{const a=[...step.branches],i=a.findIndex(b=>b.condition===undefined);a.splice(i===-1?a.length:i,0,{condition:true,steps:[]});field('branches',a)}}>加入条件分支</button>
      {!step.branches.some(b=>b.condition===undefined)&&<button onClick={()=>field('branches',[...step.branches,{steps:[]}])}>加入否则</button>}</>;
    case 'write': return <>{step.operations.map((op,i)=>{const update=patch=>field('operations',changeAt(step.operations,i,{...op,...patch}));
      const row=catalog.objects.find(r=>r.source===op.ref?.source&&r.id===op.ref?.id);
      const fields=catalog.types.find(r=>r.source===row?.source&&r.id===row?.type)?.fields||{};
      return <div style={panel} key={i}><Choice label="修改方式" value={op.kind} options={[['set','设值'],['add','增减'],['consume','消耗']]} change={kind=>update({kind})}/>
        <ObjectRef value={op.ref} catalog={catalog} change={ref=>update({ref})}/>
        {op.kind!=='consume'&&<><Choice label="字段" value={op.field} options={Object.keys(fields).map(k=>[k,k])} change={field=>update({field})}/>
        <Expression value={op.value} change={value=>update({value})} catalog={catalog}/></>}
        <button onClick={()=>field('operations',step.operations.filter((_,j)=>j!==i))}>移除修改</button></div>;})}
      <button onClick={()=>field('operations',[...step.operations,init('write').operations[0]])}>同批加入修改</button></>;
    case 'spawn': return <><Choice label="实例类型" value={JSON.stringify([step.source,step.row.type])} options={catalog.types.map(t=>[JSON.stringify([t.source,t.id]),t.name||t.id])} change={v=>{if(v){const [source,type]=JSON.parse(v);set({...step,source,row:{type,fields:{}}});}}}/>
      <label>数量</label>{expr('count')}<label>实例初值</label><JsonValue value={step.row.fields} save={fields=>field('row',{...step.row,fields})}/></>;
    case 'method': {
      if(step.binding!==undefined)return <><label>从属性取得方法</label>{expr('binding')}<label>结果名称<input value={step.as||''} onChange={e=>field('as',e.target.value)}/></label>
        <button onClick={()=>{const {binding,...direct}=step;set(direct);}}>改为直接选择方法</button></>;
      const item=catalog.sources.find(r=>r.id===step.source), method=item?.methods?.find(r=>r.id===step.method);
      const fields=step.args?.fields??step.args??{};
      return <><button onClick={()=>field('binding',{op:'read',ref:{source:'world',id:''},path:[]})}>从对象属性取得方法</button><Choice label="来源" value={step.source} options={opts(catalog.sources)} change={source=>set({...step,source,method:'',args:{op:'object',fields:{}}})}/>
        <Choice label="方法" value={step.method} options={opts(item?.methods||[])} change={method=>field('method',method)}/>
        {Object.entries(method?.inputs||{}).map(([k,s])=><fieldset key={k}><legend>{k} · {s.kind??s} {s.required?'必填':''}</legend>
          <Expression catalog={catalog} value={fields[k]??null} change={v=>field('args',{op:'object',fields:{...fields,[k]:v}})}/></fieldset>)}
        <label>结果名称<input value={step.as||''} onChange={e=>field('as',e.target.value)}/></label></>;
    }
    case 'lines':return <Lines rows={step.rows} save={v=>field('rows',v)}/>;
    case 'macro':return <><Choice label="共享演出" value={step.id} options={opts(catalog.macros)} change={v=>field('id',v)}/><JsonValue value={step.args??{}} save={v=>field('args',v)}/></>;
    case 'fragment':return <FragmentRefPicker value={step.target} onChange={v=>field('target',v)}/>;
    case 'repeat':return <>{expr('condition')}{sub(step.steps,v=>field('steps',v))}</>;
    case 'parallel':return <><Choice label="接下来的步骤何时执行" value={step.join??'all'} options={[['all','全部完成后'],['first','首项完成后'],['none','立即继续']]} change={v=>field('join',v)}/>
      {step.branches.map((b,i)=><fieldset key={i}><legend>并行任务 {i+1}</legend>{sub(b,v=>field('branches',changeAt(step.branches,i,v)))}</fieldset>)}<button onClick={()=>field('branches',[...step.branches,[]])}>加入任务</button></>;
    case 'listen':return <><Choice label="监听" value={step.id} options={opts(catalog.listeners)} change={v=>field('id',v)}/>
      <label>作用域<input value={step.scope} onChange={e=>field('scope',e.target.value)}/></label><label><input type="checkbox" checked={step.enabled} onChange={e=>field('enabled',e.target.checked)}/>启用</label></>;
    case 'event':return <><label>事件<input value={step.event} onChange={e=>field('event',e.target.value)}/></label><label>作用域<input value={step.scope} onChange={e=>field('scope',e.target.value)}/></label>
      <label>随事件传入的参数</label><JsonValue value={step.args??{}} save={v=>field('args',v)}/></>;
    case 'return':return expr('value');
    case 'cancel':case 'wait':return expr('jobs');
    case 'play':return expr('targets');
    default:return <JsonValue value={step} save={set}/>;
  }
}
export function Program({steps=[],save,catalog,depth=0}){
  const [kind,setKind]=useState('branch');
  if(depth>5)return <JsonValue value={steps} save={save}/>;
  return <div>{steps.map((step,i)=><details key={i} style={panel}><summary>{i+1}. {actions[step.kind]||step.kind} {step.as?'→ '+step.as:''}</summary>
    <Step step={step} catalog={catalog} set={v=>save(changeAt(steps,i,v))} depth={depth}/>
    <details><summary>失败时执行</summary><Program steps={step.onError??[]} save={items=>{
      const next={...step};if(items.length)next.onError=items;else delete next.onError;save(changeAt(steps,i,next));
    }} catalog={catalog} depth={depth+1}/></details>
    {step.kind!=='method'&&<label>将结果保存为<input value={step.as||''} onChange={e=>save(changeAt(steps,i,{...step,as:e.target.value}))}/></label>}
    <div style={rowStyle}><button disabled={i===0} onClick={()=>{const a=[...steps];[a[i-1],a[i]]=[a[i],a[i-1]];save(a)}}>上移</button>
      <button onClick={()=>save(steps.filter((_,j)=>j!==i))}>移除这步</button></div></details>)}
    <div style={rowStyle}><Choice label="动作" value={kind} options={Object.entries(actions)} change={setKind}/><button onClick={()=>save([...steps,init(kind)])}>加入步骤</button></div></div>;
}
