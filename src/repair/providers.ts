import { readFile,writeFile,mkdir } from "node:fs/promises";
import { dirname,relative,resolve } from "node:path";
import type { RepositoryFinding } from "../detector/types.js";
import type { RepairAgent } from "./types.js";
type Complete=(prompt:string)=>Promise<string>;
function inside(root:string,path:string){const p=relative(root,path);return p===""||(p!==".."&&!p.startsWith("../"))}
function allowed(path:string,scopes:string[]){return scopes.some(s=>path===s||path.startsWith(s.replace(/\/$/,"")+"/"))}
function protectedPath(path:string){return path==="software-oath.yml"||path==="CODEOWNERS"||path===".github/CODEOWNERS"||path.startsWith(".software-oath/")||path.startsWith(".github/workflows/")}
export class StructuredRepairAgent implements RepairAgent{
 readonly name:string;
 constructor(private options:{name:string;complete:Complete}){this.name=options.name}
 async repair(input:{workspacePath:string;prompt:string;finding?:RepositoryFinding}){
  if(!input.finding)throw new Error("Structured repair requires a selected finding.");
  const root=resolve(input.workspacePath),scopes=input.finding.repair.allowedPaths;
  const files=[] as Array<{path:string;content:string}>;
  for(const path of scopes){const target=resolve(root,path);if(!inside(root,target))throw new Error("Repair scope escapes workspace.");const content=await readFile(target,"utf8").catch(()=>undefined);if(content!==undefined)files.push({path,content})}
  if(Buffer.byteLength(JSON.stringify(files))>262144)throw new Error("Repair context exceeds 256 KiB.");
  const raw=await this.options.complete(input.prompt+"\nReturn JSON only: {summary,changes:[{path,content}]}.\nAuthorized files:"+JSON.stringify(files));
  const body=raw.match(/\x60\x60\x60(?:json)?\s*([\s\S]*?)\x60\x60\x60/i)?.[1]??raw;
  const result=JSON.parse(body) as {summary:string;changes:Array<{path:string;content:string}>};
  if(typeof result.summary!=="string"||!Array.isArray(result.changes))throw new Error("Invalid structured repair response.");
  const seen=new Set<string>();
  for(const change of result.changes){change.path=change.path.replaceAll("\\","/").replace(/^\.\//,"");const target=resolve(root,change.path);if(typeof change.content!=="string"||!inside(root,target)||!allowed(change.path,scopes)||protectedPath(change.path)||seen.has(change.path))throw new Error("Unauthorized structured repair change.");seen.add(change.path)}
  for(const change of result.changes){const target=resolve(root,change.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,change.content,"utf8")}
  return{summary:result.summary,output:raw.slice(-20000)}
 }
}
// Provider payload shapes differ; callers immediately select documented response fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function post(fetcher:typeof fetch,url:string,body:unknown,headers:Record<string,string>={}){const r=await fetcher(url,{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)});if(!r.ok)throw new Error("Repair provider HTTP "+r.status);return await r.json() as any}
export function repairAgentFromEnvironment(env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch):RepairAgent|undefined{
 const provider=env.SOFTWARE_OATH_REPAIR_PROVIDER?.trim().toLowerCase();if(!provider||provider==="disabled")return;
 const model=env.SOFTWARE_OATH_REPAIR_MODEL?.trim(),key=env.SOFTWARE_OATH_REPAIR_API_KEY?.trim();if(!model)throw new Error("SOFTWARE_OATH_REPAIR_MODEL is required.");
 if(provider==="openai"||provider==="ollama"){if(provider==="openai"&&!key)throw new Error("Repair API key is required.");const base=(env.SOFTWARE_OATH_REPAIR_BASE_URL??(provider==="ollama"?"http://127.0.0.1:11434/v1":"https://api.openai.com/v1")).replace(/\/$/,"");return new StructuredRepairAgent({name:provider+"/"+model,complete:async prompt=>(await post(fetcher,base+"/chat/completions",{model,messages:[{role:"user",content:prompt}],response_format:{type:"json_object"}},key?{Authorization:"Bearer "+key}:{})).choices[0].message.content})}
 if(provider==="anthropic"){if(!key)throw new Error("Repair API key is required.");return new StructuredRepairAgent({name:"anthropic/"+model,complete:async prompt=>(await post(fetcher,(env.SOFTWARE_OATH_REPAIR_BASE_URL??"https://api.anthropic.com/v1")+"/messages",{model,max_tokens:8192,messages:[{role:"user",content:prompt}]},{"x-api-key":key,"anthropic-version":"2023-06-01"})).content[0].text})}
 if(provider==="gemini"){if(!key)throw new Error("Repair API key is required.");return new StructuredRepairAgent({name:"gemini/"+model,complete:async prompt=>(await post(fetcher,(env.SOFTWARE_OATH_REPAIR_BASE_URL??"https://generativelanguage.googleapis.com/v1beta")+"/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(key),{contents:[{parts:[{text:prompt}]}]})).candidates[0].content.parts[0].text})}
 throw new Error("Unsupported repair provider: "+provider)
}
