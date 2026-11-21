import {checkValue,World} from './world.js';

export function inspectCatalog(catalog,callSites=[],chapters) {
  const issues=[];
  const issue=(location,message)=>issues.push({location,message});
  let world;
  try{world=new World(catalog);}catch(e){issue(e.location||'世界资料',e.message);return issues;}
  const rules=new Map(catalog.rules.map(row=>[row.id,row]));
  const methods=new Map(catalog.sources.map(source=>[source.id,new Map((source.methods||[]).map(m=>[m.id,m]))]));
  const macroIds=new Set(catalog.macros.map(m=>m.id));
  const fragments=chapters && new Map(chapters.map(chapter=>[chapter.id,new Set(chapter.fragments.map(fragment=>fragment.id))]));
  function checkTarget(target,place){
    if(target?.op){infer(target,place);return;}
    if(fragments && target?.fragmentId && !fragments.get(target.chapterId)?.has(target.fragmentId)){
      issue(place,'找不到原生片段 '+target.fragmentId);
    }
  }
  function infer(node,place,chain=[]) {
    if(!node||typeof node!=='object'||!node.op){
      if(typeof node==='string')return 'text';if(typeof node==='boolean')return 'boolean';if(typeof node==='number')return 'number';
      return Array.isArray(node)?'list':(node?.fragmentId?'fragment':node?.source&&node.id?'ref':'object');
    }
    if(node.op==='read' && node.ref?.source && node.ref.id && !methods.has(node.ref.source)){
      try {
        let value=node.ref;
        if(!node.path?.length)return 'object';
        for(const field of node.path){
          if(value?.source && value?.id){
            if(methods.has(value.source))return;
            value=world.read(value,[field]);
          }else{
            if(value==null || !Object.hasOwn(value,field)){issue(place,'找不到字段 '+field);return;}
            value=value[field];
          }
        }
        return infer(value,place);
      }catch(e){issue(place,e.message);return;}
    }
    if(node.op==='rule'){
      if(!rules.has(node.id))issue(place,'找不到条件组 '+node.id);
      else if(chain.includes(node.id))issue(place,'条件组循环引用 '+[...chain,node.id].join(' → '));
      else infer(rules.get(node.id).condition,place+' → '+node.id,[...chain,node.id]);
      return 'boolean';
    }
    if(['all','any'].includes(node.op)){
      if(!Array.isArray(node.items)){issue(place,'条件组需要成员列表');return;}
      node.items.forEach((n,i)=>infer(n,place+'.items['+i+']',chain));return 'boolean';
    }
    if(node.op==='not'){infer(node.value,place+'.value',chain);return 'boolean';}
    if('left' in node && 'right' in node){
      const a=infer(node.left,place+'.left',chain),b=infer(node.right,place+'.right',chain);
      if(!['eq','ne'].includes(node.op)&&((a&&a!=='number')||(b&&b!=='number')))issue(place,'该运算需要数值');
      return ['plus','minus','times','divide'].includes(node.op)?'number':'boolean';
    }
    if(node.op==='object')return 'object';if(node.op==='list')return 'list';
  }
  function steps(list,place){
    if(!Array.isArray(list)){issue(place,'需要动作列表');return;}
    list.forEach((step,i)=>{
      const p=place+'['+i+']';
      if(step.kind==='branch'){
        if(!Array.isArray(step.branches))return issue(p,'需要分支列表');
        step.branches.forEach((b,j)=>{if('condition' in b)infer(b.condition,p+'.branches['+j+'].condition');steps(b.steps,p+'.branches['+j+'].steps');});
      }
      if(step.kind==='parallel')step.branches?.forEach((b,j)=>steps(b,p+'.parallel['+j+']'));
      if(step.kind==='repeat'){infer(step.condition,p+'.condition');steps(step.steps,p+'.steps');}
      if(step.kind==='return')infer(step.value,p+'.value');
      if(step.kind==='fragment')checkTarget(step.target,p+'.target');
      if(step.kind==='play'){
        if(Array.isArray(step.targets))step.targets.forEach((target,j)=>checkTarget(target,p+'.targets['+j+']'));
        else infer(step.targets,p+'.targets');
      }
      if(step.kind==='macro'&&!macroIds.has(step.id))issue(p,'找不到共享演出 '+step.id);
      if(step.kind==='method'){
        if(step.binding!==undefined){infer(step.binding,p+'.binding');if(step.onError)steps(step.onError,p+'.onError');return;}
        const m=methods.get(step.source)?.get(step.method);
        if(!m){issue(p,'找不到来源或方法 '+step.source+'/'+step.method);return;}
        const args=step.args?.op==='object'?step.args.fields:step.args;
        for(const [k,spec] of Object.entries(m.inputs||{})){
          if(!Object.hasOwn(args||{},k)){if(spec.required)issue(p+'.args.'+k,'缺少必填输入');continue;}
          const actual=infer(args[k],p+'.args.'+k), expected=spec.kind??spec;
          if(actual&&actual!==expected)issue(p+'.args.'+k,'需要 '+expected+'，当前是 '+actual);
        }
      }
      if(step.kind==='write')for(const [j,op] of (step.operations??[]).entries()){
        if(!op.ref?.source||!op.ref.id||!['set','add'].includes(op.kind))continue;
        try{
          const row=world.get(op.ref), spec=world.types.get(JSON.stringify([row.source,row.type])).fields[op.field];
          if(!spec)throw Error('字段不存在 '+op.field);
          if(!op.value?.op)checkValue(op.value,spec,p+'.operations['+j+'].value');
        }catch(e){issue(p+'.operations['+j+']',e.message);}
      }
      if(step.onError)steps(step.onError,p+'.onError');
    });
  }
  for(const rule of catalog.rules)infer(rule.condition,'条件组/'+rule.id,[rule.id]);
  for(const l of catalog.listeners){infer(l.condition,'监听/'+l.id+'.condition');steps(l.steps,'监听/'+l.id+'.steps');}
  const sites=new Set();
  for(const site of callSites){
    if(!site.id||sites.has(site.id))issue(site.location,'调用位置编号为空或重复');
    sites.add(site.id);steps(site.steps,site.location);
  }
  return issues;
}
export function storyCalls(chapters){
  const result=[];
  for(const chapter of chapters)for(const fragment of chapter.fragments) {
    function inspect(block){
      if(block.type==='callExtensionFunction'&&block.props?.target==='mixing-entropy.world-state/run'){
        const location=chapter.name+' / '+fragment.name+' / '+block.id;
        try{
          const params=JSON.parse(block.props.paramsJson||'{}');
          result.push({location,id:params.site?.value,steps:params.steps?.value||[]});
        }catch{result.push({location,id:null,steps:null});}
      }
      for(const child of block.children||[])inspect(child);
    }
    for(const block of fragment.blocks)inspect(block);
  }
  return result;
}
