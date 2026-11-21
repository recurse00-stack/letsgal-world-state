import { checkValue, need } from './world.js';

export function sourceDocument(doc) {
  if(typeof doc.declaration !== 'string')return doc;
  try { return {...JSON.parse(doc.declaration),id:doc.id,name:doc.name,source:doc.source,kind:doc.kind,
    definition:JSON.parse(doc.definition || '{}')}; }
  catch { throw Error('来源声明格式错误 · '+doc.source); }
}
export function sourceDeclarations(documents) {
  return documents.map(sourceDocument).map(doc=>{
    need(typeof doc.source==='string' && Array.isArray(doc.methods),'BAD_SOURCE',doc.id);
    return {id:doc.source,name:doc.name||doc.source,methods:doc.methods,types:doc.types||[],objects:doc.objects||[]};
  });
}
export function withDirectory(catalog, documents) {
  const exposed=sourceDeclarations(documents), ids=new Set(catalog.sources.map(s=>s.id));
  for(const source of exposed) {
    need(!ids.has(source.id),'DUPLICATE_SOURCE',source.id);
    ids.add(source.id);
  }
  return {...catalog,sources:[...catalog.sources,...exposed]};
}
export function authorEntries(catalog,documents){
  const entries=[];
  for(const group of ['objects','types','rules','listeners','macros','renderers','sources'])
    for(const row of catalog[group]??[])entries.push({group,source:row.source??'world',id:row.id,name:row.name??row.id,tags:row.tags??[],row});
  for(const doc of documents.map(sourceDocument)){
    const add=(id,name,tags=[])=>entries.push({group:'external',source:doc.source,id,name:name||id,tags,row:doc});
    add(doc.source,doc.name);
    for(const method of doc.methods||[])add(method.id,method.name,['方法']);
    for(const type of doc.types||[])add(type.id,type.name,['类型']);
    for(const [field,spec] of Object.entries(doc.authorFields||{}))add(field,spec.name,['定义',spec.writable?'可编辑':'只读']);
    for(const row of doc.objects||[])add(row.id,row.name,row.tags);
  }
  return entries;
}
export function editDefinition(document, name, value) {
  const field=document.authorFields?.[name];
  need(field?.writable===true,'READ_ONLY',document.source+'.'+name);
  checkValue(value,field,document.source+'.'+name);
  return {...document.definition,[name]:value};
}
