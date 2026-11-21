import React, { useEffect, useState } from 'react';
import { AutoParams, CharacterPicker, FragmentRefPicker, useDataCollection, useInspectorEnvironment, useParam, useSetting, useStorySnapshot } from '@avg-studio/studio-ui';
import { emptyCatalog, World } from './world.js';

import { Expression, Fields, FieldValues, Initial, JsonValue } from './forms.jsx';
import { Program } from './program.jsx';
import { authorEntries, editDefinition, sourceDocument, withDirectory } from './sources.js';
import { inspectCatalog, storyCalls } from './inspect.js';

const groups = {types:'对象类型',objects:'对象与初值',rules:'条件组',listeners:'监听',macros:'共享演出',renderers:'对白模板',sources:'接入来源'};
const tabStyle = {display:'flex',gap:6,flexWrap:'wrap',margin:'9px 0'};
const fieldStyle = {display:'grid',gap:4,margin:'8px 0'};
const pretty = v => JSON.stringify(v,null,2);

const fresh = group => {
  const id = crypto.randomUUID();
  return {
    types:{id,name:'新类型',source:'world',fields:{value:{kind:'number'}},defaults:{value:0}},
    objects:{id,name:'新对象',source:'world',type:'',tags:[],fields:{}},
    rules:{id,name:'新条件组',condition:{op:'all',items:[]}},
    listeners:{id,name:'新监听',event:'enter',tags:[],condition:true,steps:[]},
    macros:{id,name:'新演出',target:{chapterId:'',fragmentId:''}},
    renderers:{id,name:'新对白模板',speaker:'',target:{chapterId:'',fragmentId:''}},
    sources:{id,name:'新来源',methods:[]}
  }[group];
};
function Select({label,value,onChange,values}) {
  return <label style={fieldStyle}>{label}<select value={value||''} onChange={e=>onChange(e.target.value)}>
    <option value="">请选择</option>{values.map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>;
}
function JsonField({name,value,onChange}) {
  const [draft,setDraft] = useState(()=>pretty(value));
  const [error,setError] = useState('');
  useEffect(()=>{setDraft(pretty(value));setError('');},[value]);
  return <label style={fieldStyle}>{name}<textarea rows={6} spellCheck={false} value={draft ?? ''} onChange={e=>{
    const s=e.target.value;setDraft(s);
    try {const parsed=JSON.parse(s);setError('');onChange(parsed);} catch(e){setError(e.message);}
  }}/>{error && <small role="alert">{error}</small>}</label>;
}
const names = {source:'来源',fields:'字段',defaults:'默认值',condition:'条件表达式',tags:'词条编号',event:'事件',methods:'公开方法',steps:'动作步骤'};
function WorkbenchStyle(){return <style>{`
.ws-author{color:inherit;font:inherit;line-height:1.55;padding:12px 14px;max-width:920px;container-type:inline-size}
.ws-author h2{font-size:20px;letter-spacing:.06em;margin:0 0 14px}.ws-author h3{font-size:17px}
.ws-author nav{padding:5px 0 10px;border-bottom:1px solid #81899b55}.ws-author summary{cursor:pointer;font-weight:600}
.ws-author button,.ws-author select,.ws-author input:not([type=checkbox]),.ws-author textarea{border:1px solid #78849a75;border-radius:5px;color:inherit;background:color-mix(in srgb,currentColor 5%,transparent);font:inherit;padding:5px 9px;max-width:100%}
.ws-author select option{background:Canvas;color:CanvasText}.ws-author button{cursor:pointer;min-height:30px}.ws-author button+button{margin-left:3px}
.ws-author button[aria-pressed=true],.ws-author button:hover,.ws-author summary:hover{color:#8bdac8;border-color:#69ab9d}
.ws-author button:disabled{opacity:.45;cursor:default}.ws-author small{opacity:.75}.ws-author article,.ws-author fieldset{padding:10px;border:1px solid #8993a54d;border-radius:7px}
.ws-author fieldset{margin:8px 0;min-width:0}.ws-author details{padding:6px 0}.ws-author textarea{width:100%;resize:vertical}
.ws-author label{display:block}.ws-author input::placeholder{opacity:.7;color:inherit}.ws-author [role=alert]{color:#ecad8e}
.ws-author button:focus-visible,.ws-author input:focus-visible,.ws-author select:focus-visible{outline:2px solid #6ec2af;outline-offset:2px}
`}</style>}
function Editor({group,row,catalog,save,cancel}) {
  const [draft,setDraft]=useState(()=>structuredClone(row));
  const [error,setError]=useState('');
  const put=(k,v)=>setDraft(d=>({...d,[k]:v}));
  return <article><h3>{draft.name}</h3><label style={fieldStyle}>显示名称<input value={draft.name} onChange={e=>put('name',e.target.value)}/></label>
    <label style={fieldStyle}>稳定编号<input value={draft.id} readOnly/></label>
    {Object.entries(draft).filter(([k])=>!['name','id'].includes(k)).map(([k,v])=>{
      if(k==='fields' && group==='types')return <div key={k}><Fields row={draft} put={patch=>setDraft(d=>({...d,...patch}))}/><details><summary>嵌套字段规格</summary><JsonValue value={v} save={v=>put(k,v)}/></details></div>;
      if(k==='defaults' && group==='types')return <div key={k}><b>新对象的默认值</b><FieldValues fields={draft.fields} values={v} catalog={catalog} change={v=>put(k,v)}/></div>;
      if(k==='fields' && group==='objects'){
        const type=catalog.types.find(t=>t.source===draft.source&&t.id===draft.type);
        return <FieldValues key={k} fields={type?.fields??{}} defaults={type?.defaults??{}} values={v} catalog={catalog} change={v=>put(k,v)}/>;
      }
      if(k==='steps')return <Program key={k} steps={v} catalog={catalog} save={steps=>put(k,steps)}/>;
      if(k==='condition')return <Expression key={k} value={v} change={v=>put(k,v)} catalog={catalog}/>;
      if(k==='speaker')return <label key={k} style={fieldStyle}>说话角色（留空为旁白）<CharacterPicker value={v} onChange={s=>put(k,s)}/></label>;
      if(k==='target')return <FragmentRefPicker key={k} ariaLabel="目标章节和片段" value={v} onChange={ref=>put(k,ref)}/>;
      if(k==='type')return <Select key={k} label="对象类型" value={v} onChange={v=>put(k,v)} values={catalog.types.filter(t=>t.source===draft.source).map(t=>[t.id,t.name])}/>;
      if(typeof v==='string')return <label key={k} style={fieldStyle}>{names[k]??k}<input value={v} onChange={e=>put(k,e.target.value)}/></label>;
      return <JsonField key={k} name={names[k]??k} value={v} onChange={v=>put(k,v)}/>;
    })}
    {error && <p role="alert">{error}</p>}
    <div style={tabStyle}><button onClick={()=>{try{save(draft)}catch(e){setError(e.message)}}}>保存</button><button onClick={cancel}>取消</button></div>
  </article>;
}
function GlobalSearch({catalog,directory,open}){
  const [term,setTerm]=useState(''),[source,setSource]=useState(''),[limit,setLimit]=useState(50);
  const [opened,setOpened]=useState(false);
  const rows=React.useMemo(()=>opened?authorEntries(catalog,directory.documents.filter(r=>r.kind==='source')):[],[opened,catalog,directory.documents]);
  const normalized=term.trim().toLowerCase(),matches=normalized||source?rows.filter(r=>(!source||r.source===source)&&[r.name,r.id,r.source,...r.tags].some(v=>String(v??'').toLowerCase().includes(normalized))):[];
  return <details onToggle={e=>setOpened(e.currentTarget.open)}><summary>跨来源搜索</summary><div style={tabStyle}><input aria-label="跨来源搜索" value={term} placeholder="对象、词条、方法或稳定编号" onChange={e=>{setLimit(50);setTerm(e.target.value)}}/>
    <select aria-label="限定来源" value={source} onChange={e=>{setLimit(50);setSource(e.target.value)}}><option value="">所有来源</option>{[...new Set(rows.map(r=>r.source))].map(id=><option key={id}>{id}</option>)}</select></div>
    {matches.slice(0,limit).map((r,i)=><div key={r.source+'/'+r.group+'/'+r.id+'/'+i}><button onClick={()=>open(r)}>{r.name}</button> <small>{r.source} / {r.id}</small></div>)}
    {(normalized||source)&&<p>{matches.length} 条结果</p>}{matches.length>limit&&<button onClick={()=>setLimit(limit+50)}>显示更多</button>}</details>;
}
function ExternalSource({row,collection,catalog,expanded=false}) {
  const [editing,setEditing]=useState(null),[error,setError]=useState('');
  return <details open={expanded||undefined}><summary>{row.name||row.source} · {row.source}</summary>
    {(row.methods||[]).map(m=><p key={m.id}>{m.name||m.id} · {Object.keys(m.inputs||{}).join('、')} → {m.output?.kind||m.output||'无返回值'}</p>)}
    {Object.entries(row.authorFields||{}).map(([key,spec])=><div key={key}>
      <b>{spec.name||key}</b> {JSON.stringify(row.definition?.[key])} {spec.writable?
        <button onClick={()=>setEditing({key,value:row.definition?.[key],revision:collection.revision})}>编辑</button>:'只读'}</div>)}
    {editing&&<><Initial kind={row.authorFields[editing.key].kind} value={editing.value} catalog={catalog} change={value=>setEditing({...editing,value})}/>
      <button onClick={async()=>{try{const definition=editDefinition(row,editing.key,editing.value);
        if(!await collection.updateOne(row.id,{definition:JSON.stringify(definition)},editing.revision))throw Error('来源记录不存在');
        setEditing(null);setError('');}catch(e){setError(e.message);}}}>保存到来源</button><button onClick={()=>setEditing(null)}>取消</button></>}
    {error&&<p role="alert">{error}</p>}</details>;
}
export function settingsPage() {
  const [encoded,setEncoded]=useSetting('world.catalog');
  const directory=useDataCollection('directory');
  const story=useStorySnapshot();
  const [issues,setIssues]=useState(null);
  const [debug,setDebug]=useSetting('world.debug');
  const [group,setGroup]=useState('types'),[selected,setSelected]=useState(null),[filter,setFilter]=useState('');
  const existing=React.useRef(false);
  const [external,setExternal]=useState('');
  const [page,setPage]=useState(0);
  const pageSize=60;
  const decoded=React.useMemo(()=>{
    try{return {catalog:{...emptyCatalog(),...JSON.parse(encoded||'{}')}};}
    catch(error){return {error};}
  },[encoded]);
  if(decoded.error)return <p role="alert">世界资料无法解析。{decoded.error.message}</p>;
  const catalog=decoded.catalog;
  let authorCatalog;
  try{authorCatalog=withDirectory(catalog,directory.documents.filter(r=>r.kind==='source'));}catch(e){return <p role="alert">{e.message}</p>;}
  const term=filter.trim().toLowerCase();
  const published=group==='sources'?directory.documents.filter(r=>r.kind==='source'&&[r.name,r.source].some(v=>v?.toLowerCase().includes(term))).map(sourceDocument):[];
  const visible = catalog[group].filter(row=>!term||[row.name,row.source,row.id,...(row.tags||[])].some(v=>v?.toLowerCase().includes(term)));
  const lastPage=Math.max(0,Math.ceil(visible.length/pageSize)-1),currentPage=Math.min(page,lastPage);
  function apply(row) {
    const entries=[...catalog[group]];
    const i=entries.findIndex(x=>x.id===selected.id && x.source===selected.source);
    if(i>=0 && JSON.stringify(entries[i])!==JSON.stringify(selected))throw Error('此记录已被其他编辑修改，取消后重开以读取当前版本');
    if(i<0 && existing.current)throw Error('此记录已被移除，请重新选择');
    if(i<0)entries.push(row);else entries[i]=row;
    const next={...catalog,[group]:entries};new World(next);
    const serialized=JSON.stringify(next);
    if(serialized!==encoded&&!setEncoded(serialized))throw Error('Studio 未接受本次修改，草稿已保留');
    setSelected(null);
  }
  return <main className="ws-author"><WorkbenchStyle/><h2>世界状态</h2>
    <GlobalSearch catalog={catalog} directory={directory} open={r=>{setPage(0);setFilter('');existing.current=true;setExternal(r.source);setGroup(r.group==='external'?'sources':r.group);setSelected(r.group==='external'?null:r.row);}}/>
    <nav style={tabStyle}>{Object.entries(groups).map(([key,label])=><button aria-pressed={group===key} key={key} onClick={()=>{setGroup(key);setSelected(null);setPage(0);setFilter('')}}>{label}</button>)}</nav>
    <div style={tabStyle}><input aria-label="搜索名称、来源、编号或词条" placeholder="名称、来源、编号或词条" value={filter} onChange={e=>{setPage(0);setFilter(e.target.value)}}/>
    <button onClick={()=>{existing.current=false;setSelected(fresh(group))}}>新增{groups[group]}</button></div>
    {group==='sources'&&<>{directory.error&&<p role="alert">{directory.error.message}</p>}
      {published.map(row=><ExternalSource key={row.id} row={row} collection={directory} catalog={authorCatalog} expanded={external===row.source}/>)}</>}
    {selected ? <Editor key={group+selected.id} group={group} row={selected} catalog={authorCatalog} save={apply} cancel={()=>setSelected(null)}/> :
      <><p>{visible.length+published.length} 条</p>{visible.slice(currentPage*pageSize,(currentPage+1)*pageSize).map(row=><div key={JSON.stringify([row.source,row.id])}><button onClick={()=>{existing.current=true;setSelected(row)}}>{row.name||row.id}</button> <small>{row.source} {row.id}</small></div>)}
      {lastPage>0&&<nav style={tabStyle} aria-label="资料分页"><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage+1} / {lastPage+1}</span><button disabled={currentPage>=lastPage} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}</>}
    <label style={fieldStyle}><span><input type="checkbox" checked={!!debug} onChange={e=>setDebug(e.target.checked)}/> 开发者日志</span></label>
    <button onClick={()=>{try{setIssues(inspectCatalog(withDirectory(catalog,directory.documents.filter(r=>r.kind==='source')),storyCalls(story.chapters),story.chapters));}
      catch(e){setIssues([{location:'工作台',message:e.message}]);}}}>检查此工程的调用引用</button>
    {issues&&<div role="status">{issues.length?<ul>{issues.map((e,i)=><li key={i}>{e.location} · {e.message}</li>)}</ul>:'已核对当前可静态定位的引用'}</div>}

  </main>;
}
function RunInspector(){
  const [site,setSite]=useParam('site'),[steps,setSteps]=useParam('steps'),[encoded]=useSetting('world.catalog');
  const {readOnly}=useInspectorEnvironment();
  const directory=useDataCollection('directory');
  let catalog=emptyCatalog(),loadError='';
  try{catalog=withDirectory({...catalog,...JSON.parse(encoded||'{}')},directory.documents.filter(r=>r.kind==='source'));}catch(e){loadError=e.message;}
  const [mode,setMode]=useState('fragment'),[macro,setMacro]=useState(''),[target,setTarget]=useState();
  return <section className="ws-author"><WorkbenchStyle/><label style={fieldStyle}>调用位置编号<input value={site||''} disabled={readOnly} onChange={e=>setSite(e.target.value)}/></label>
    <button disabled={readOnly} onClick={()=>setSite(crypto.randomUUID())}>{site?'为复制的调用生成新编号':'生成调用编号'}</button>
    <Select label="加入演出" value={mode} onChange={setMode} values={[['fragment','此处的片段'],['macro','共享演出']]}/>
    {mode==='macro'?<Select label="共享演出" value={macro} onChange={setMacro} values={catalog.macros.map(m=>[m.id,m.name])}/>:
      <FragmentRefPicker ariaLabel="选择原生片段" value={target} onChange={setTarget} disabled={readOnly}/>}
    <button disabled={readOnly || (mode==='macro'?!macro:!target?.fragmentId)} onClick={()=>setSteps([...(steps||[]),mode==='macro'?{kind:'macro',id:macro}:{kind:'fragment',target}])}>追加到步骤</button>

    {loadError&&<p role="alert">{loadError}</p>}<fieldset disabled={readOnly}><legend>动作编排</legend><Program steps={steps??[]} save={setSteps} catalog={catalog}/></fieldset>
    <details><summary>结构化步骤与调用参数</summary><AutoParams include={['steps','args']}/></details></section>;
}
function ValueInspector(){
  const [node,setNode]=useParam('expression'),[encoded]=useSetting('world.catalog');
  const {readOnly}=useInspectorEnvironment();
  const directory=useDataCollection('directory');
  let catalog;
  try{catalog=withDirectory({...emptyCatalog(),...JSON.parse(encoded||'{}')},directory.documents.filter(r=>r.kind==='source'));}catch(e){return <p role="alert">{e.message}</p>;}
  return <fieldset disabled={readOnly}><legend>读取或判断</legend><Expression value={node} change={setNode} catalog={catalog}/><AutoParams include={['args']}/></fieldset>;
}
export const inspectors={run:RunInspector,test:ValueInspector,number:ValueInspector,text:ValueInspector};
