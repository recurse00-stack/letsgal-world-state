import React,{useState} from 'react';
import {FragmentRefPicker} from '@avg-studio/studio-ui';
const style={display:'grid',gap:6,margin:'6px 0'};
export function Choice({label,value,options,change}) {
  return <label style={style}>{label}<select value={value??''} onChange={e=>change(e.target.value)}>
    <option value="">请选择</option>{options.map(([v,title])=><option key={v} value={v}>{title}</option>)}</select></label>;
}
const kinds=['number','text','boolean','ref','fragment','list','object','action'];
const labels={number:'数值',text:'文本',boolean:'开关',ref:'对象引用',fragment:'原生片段',list:'列表',object:'结构',action:'来源方法'};
export function Initial({kind,value,change,catalog}) {
  if(kind==='boolean')return <label><input type="checkbox" checked={!!value} onChange={e=>change(e.target.checked)}/> 是</label>;
  if(kind==='action')return <><Choice label="绑定来源" value={value?.source} options={catalog.sources.map(s=>[s.id,s.name||s.id])} change={source=>change({source,method:'',args:{}})}/>
    <Choice label="绑定方法" value={value?.method} options={(catalog.sources.find(s=>s.id===value?.source)?.methods||[]).map(m=>[m.id,m.name||m.id])} change={method=>change({...value,method})}/>
    <label>绑定参数</label><JsonValue value={value?.args??{}} save={args=>change({...value,args})}/></>;
  if(kind==='ref') return <ObjectRef value={value} change={change} catalog={catalog}/>;
  if(kind==='fragment') return <FragmentRefPicker value={value} onChange={change}/>;
  if(kind==='number'||kind==='text')return <input aria-label="字段值" type={kind==='number'?'number':'text'} value={value??''} onChange={e=>change(kind==='number'?Number(e.target.value):e.target.value)}/>;
  return <JsonValue value={value??(kind==='list'?[]:{})} save={change}/>;
}
export function JsonValue({value,save}) {
  const [draft,setDraft]=useState(null); const [error,setError]=useState('');
  return <div style={style}><textarea aria-label="结构化值" value={draft??JSON.stringify(value,null,2)} rows={4} onChange={e=>setDraft(e.target.value)}/>
    {draft!==null&&<button type="button" onClick={()=>{try{save(JSON.parse(draft));setDraft(null);setError('');}catch(e){setError(e.message);}}}>应用结构化值</button>}{error&&<small role="alert">{error}</small>}</div>;
}
export function ObjectRef({value,change,catalog}){
  const [search,setSearch]=useState('');
  const published = catalog.sources.flatMap(source=>(source.objects||[]).map(row=>({...row,source:source.id})));
  const found=[...catalog.objects,...published].filter(r=>[r.id,r.source,r.name].some(x=>x?.toLowerCase().includes(search.toLowerCase())));
  return <div style={style}><input placeholder="搜索来源、名称或编号" aria-label="搜索对象" value={search} onChange={e=>setSearch(e.target.value)}/>
    <Choice label="对象" value={value?.id?JSON.stringify([value.source,value.id]):''}
      options={found.slice(0,150).map(r=>[JSON.stringify([r.source,r.id]),(r.name||r.id)+' · '+r.source+' · '+r.id])}
      change={v=>{if(v){const [source,id]=JSON.parse(v);change({source,id});}}}/>
    {value?.id&&<small>{value.source} / {value.id}</small>}</div>;
}
export function Fields({row,put}){
  const [name,setName]=useState(''),[kind,setKind]=useState('number');
  return <fieldset><legend>字段</legend>{Object.entries(row.fields).map(([name,spec])=><div key={name}>{name} · {labels[spec.kind??spec]}
    <button type="button" onClick={()=>{const fields={...row.fields},defaults={...row.defaults};delete fields[name];delete defaults[name];put({fields,defaults});}}>移除</button></div>)}
    <label style={style}>字段编号<input value={name} onChange={e=>setName(e.target.value)}/></label>
    <Choice label="值类型" value={kind} options={kinds.map(k=>[k,labels[k]])} change={setKind}/>
    <button type="button" disabled={!name.trim()||Object.hasOwn(row.fields,name.trim())} onClick={()=>{put({fields:{...row.fields,[name.trim()]:{kind}}});setName('');}}>加入字段</button></fieldset>;
}
export function FieldValues({fields,values={},defaults,catalog,change}){
  return <fieldset><legend>字段值</legend>{Object.entries(fields).map(([name,spec])=>{
    const own=Object.hasOwn(values,name);
    const inherited=defaults&&Object.hasOwn(defaults,name);
    return <div key={name} style={style}><b>{name}</b>
      {defaults&&<small>{own?'此对象的初值':inherited?'沿用类型默认值':'尚未填写'}</small>}
      <Initial kind={spec.kind??spec} value={own?values[name]:defaults?.[name]} catalog={catalog} change={v=>change({...values,[name]:v})}/>
      {defaults&&own&&<button onClick={()=>{const next={...values};delete next[name];change(next);}}>{inherited?'恢复类型默认值':'清除初值'}</button>}
    </div>;
  })}</fieldset>;
}
function Literal({value,change,catalog}){
  const kind=value&&Object.hasOwn(value,'fragmentId')?'fragment':value&&typeof value==='object'&&Object.hasOwn(value,'method')?'action':value&&typeof value==='object'&&Object.hasOwn(value,'source')&&Object.hasOwn(value,'id')?'ref':Array.isArray(value)?'list':({number:'number',string:'text',boolean:'boolean'})[typeof value]??'object';
  const defaults={text:'',number:0,boolean:false,ref:{source:'world',id:''},fragment:{chapterId:'',fragmentId:''},list:[],object:{},action:{source:'',method:'',args:{}}};
  return <><Choice label="固定值类型" value={kind} options={kinds.map(k=>[k,labels[k]])} change={k=>{if(k)change(defaults[k]);}}/>
    <Initial kind={kind} value={value} change={change} catalog={catalog}/></>;
}
export function Expression({value,change,catalog,depth=0}){
  if(depth>5)return <JsonValue value={value} save={change}/>;
  const mode=value?.op??'literal';
  const modes=[['literal','固定值'],['arg','本次参数或前一步结果'],['read','对象字段'],['rule','已保存条件'],['all','全部满足'],['any','任一满足'],['not','取反'],['eq','相等'],['ne','不等'],['gt','大于'],['ge','大于等于'],['lt','小于'],['le','小于等于'],['plus','加'],['minus','减'],['times','乘'],['divide','除'],['query','限定范围查询']];
  const nested=(v,fn)=><Expression value={v} change={fn} catalog={catalog} depth={depth+1}/>;
  function start(op){
    if(op==='literal')return true;
    if(op==='arg')return {op,path:[]};if(op==='read')return {op,ref:{source:'world',id:''},path:[]};
    if(op==='rule')return {op,id:''};if(op==='all'||op==='any')return {op,items:[true]};
    if(op==='not')return {op,value:true};if(op==='query')return {op,scope:{source:'world',type:'',mode:'exists'}};
    return {op,left:0,right:0};
  }
  return <fieldset style={style}><Choice label="取值方式" value={mode} options={modes} change={s=>s&&change(start(s))}/>
    {mode==='literal'&&<Literal value={value} change={change} catalog={catalog}/>}
    {mode==='rule'&&<><Choice label="条件组" value={value.id} options={catalog.rules.map(r=>[r.id,r.name])} change={id=>change({...value,id})}/>
      <details><summary>传给条件组的参数</summary><JsonValue value={value.args??{op:'arg',path:[]}} save={args=>change({...value,args})}/></details></>}
    {mode==='read'&&<ObjectRef catalog={catalog} value={value.ref} change={ref=>change({...value,ref})}/>}
    {(mode==='read'||mode==='arg')&&<label style={style}>依次经过的字段，用点分隔<input value={value.path.join('.')} onChange={e=>change({...value,path:e.target.value.split('.')})}/></label>}
    {(mode==='all'||mode==='any')&&<>{value.items.map((v,i)=><div key={i}>{nested(v,n=>change({...value,items:value.items.map((x,j)=>i===j?n:x)}))}
      <button onClick={()=>change({...value,items:value.items.filter((_,j)=>j!==i)})}>移除此项</button></div>)}<button onClick={()=>change({...value,items:[...value.items,true]})}>加入条件</button></>}
    {mode==='not'&&nested(value.value,v=>change({...value,value:v}))}
    {value&&Object.hasOwn(value,'left')&&<><label>左值</label>{nested(value.left,left=>change({...value,left}))}<label>右值</label>{nested(value.right,right=>change({...value,right}))}</>}
    {mode==='query'&&<JsonValue value={value.scope} save={scope=>change({...value,scope})}/>}
  </fieldset>;
}
