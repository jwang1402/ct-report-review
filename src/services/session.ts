export const apiBase=(import.meta.env.VITE_REVIEW_API_URL as string|undefined)?.replace(/\/$/,'');
export const radiologistsPath='/radiologists';
export type Cohort='senior'|'junior';
export function readerCohort(path:string):Cohort|undefined {
  return (['senior','junior'] as const).find(t=>path==='/'+t||path.startsWith('/'+t+'/'));
}
export function workspaceHome(role:Identity['role']) {
  const cohort=typeof window==='undefined'?undefined:readerCohort(window.location.hash.slice(1).split('?')[0]);
  return role==='admin'?'/admin':cohort?'/'+cohort:radiologistsPath;
}
export function workspaceRole(path:string) {
  if(path==='/admin'||path.startsWith('/admin/')||path==='/results'||path==='/upload')return 'admin';
  if(readerCohort(path)||path===''||path==='/'||path==='/cases'||path===radiologistsPath||path.startsWith(radiologistsPath+'/'))return 'doctor';
  return null;
}
function storageKey(){
  const path=window.location.hash.slice(1).split('?')[0], cohort=readerCohort(path);
  return cohort?'ct-crossover-session:'+cohort:workspaceRole(path)==='admin'?'ct-review-session':'ct-review-reader-session';
}
export function sessionToken(){try{return sessionStorage.getItem(storageKey())||'';}catch{return '';}}
function storeSession(key:string,token:unknown){
  if(typeof token!=='string'||!token)throw new Error('The server did not return a review session.');
  try{sessionStorage.setItem(key,token);}catch{throw new Error('Enable browser session storage to start a session.');}
}
export function clearSession(){try{sessionStorage.removeItem(storageKey());}catch{}window.dispatchEvent(new Event('ct-session-ended'));}
export class ResponseError extends Error {
  constructor(readonly status:number, detail:string) { super(detail); }
}
export async function api(path:string,init:RequestInit={}) {
  if(!apiBase) throw new Error('The login service is not configured yet.');
  const token=sessionToken();
  const headers=new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type','application/json');
  if (token) headers.set('Authorization','Bearer '+token);
  const response=await fetch(apiBase+path,{...init,credentials:'omit',cache:'no-store',redirect:'error',
    headers,signal:init.signal??AbortSignal.timeout(20000)});
  if(response.status===401 && token===sessionToken()) clearSession();
  const result=await response.json().catch(()=>null);
  if(!response.ok) throw new ResponseError(response.status,result?.error||'Request failed ('+response.status+').');
  if(result===null) throw new Error('The server returned an unreadable response. Please retry.');
  return result;
}
export async function login(username:string,password:string){
  const key=storageKey();
  const result=await api('/login',{method:'POST',body:JSON.stringify({username,password})});
  storeSession(key,result.token);
}
export interface Identity {username:string;role:'admin'|'doctor';display_name?:string;public_study?:string;cohort?:Cohort}
const crossoverDeviceKey=(cohort:Cohort)=>'ct-crossover-device:'+cohort;
export async function enterReader(cohort:Cohort,name:string):Promise<Identity>{
  const key=storageKey(), device=crossoverDeviceKey(cohort);
  let secret=sessionStorage.getItem(device);
  try{secret??=localStorage.getItem(device);}catch{/* Session-only storage still works. */}
  secret??=crypto.randomUUID()+crypto.randomUUID();
  sessionStorage.setItem(device,secret);
  try{localStorage.setItem(device,secret);}catch{/* Reuse the key within this tab. */}
  const result=await api('/public/crossover-readers',{method:'POST',body:JSON.stringify({cohort,name,entry_key:secret})});
  if(result.cohort!==cohort||result.role!=='doctor'||typeof result.display_name!=='string'||!result.display_name)
    throw new Error('Unable to open the reader workspace. Please try again.');
  storeSession(key,result.token);
  return {username:'',role:'doctor',display_name:result.display_name,cohort};
}
export async function joinReview(prefix:string,name:string):Promise<Identity>{
  const key=storageKey();
  const cache='ct-review-pending-reader';
  let attempt:{prefix:string;name:string;entry_key:string}|null=null;
  try {
    const saved=sessionStorage.getItem(cache);
    if(saved) attempt=JSON.parse(saved);
    if(!attempt||attempt.prefix!==prefix||attempt.name!==name||!attempt.entry_key) {
      attempt={prefix,name,entry_key:crypto.randomUUID()+crypto.randomUUID()};
      sessionStorage.setItem(cache,JSON.stringify(attempt));
    }
  } catch { throw new Error('Enable browser session storage to start a review.'); }
  const identity=await api('/public/readers',{method:'POST',body:JSON.stringify(attempt)});
  if(identity.role!=='doctor'||identity.public_study!==prefix)throw new Error('Unable to open this study.');
  storeSession(key,identity.token);
  sessionStorage.removeItem(cache);
  return {username:identity.username,role:'doctor',display_name:identity.display_name,public_study:identity.public_study};
}
export async function logout(){
  const key=storageKey(), token=sessionToken();
  const cohort=readerCohort(window.location.hash.slice(1).split('?')[0]);
  try{await api('/logout',{method:'POST'});}finally{
    const currentToken=sessionStorage.getItem(key);
    if(!currentToken||currentToken===token){
      sessionStorage.removeItem(key);
      if(cohort){
        const device=crossoverDeviceKey(cohort), current=sessionStorage.getItem(device);
        try{if(current===null||current===localStorage.getItem(device))localStorage.removeItem(device);}catch{/* Storage may be disabled. */}
        sessionStorage.removeItem(device);
      }
      if(storageKey()===key)window.dispatchEvent(new Event('ct-session-ended'));
    }
  }
}
