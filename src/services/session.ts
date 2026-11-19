export const apiBase=(import.meta.env.VITE_REVIEW_API_URL as string|undefined)?.replace(/\/$/,'');
const key='ct-review-session';
export function sessionToken(){try{return sessionStorage.getItem(key)||'';}catch{return '';}}
export function clearSession(){try{sessionStorage.removeItem(key);}catch{}window.dispatchEvent(new Event('ct-session-ended'));}
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
export async function login(username:string,password:string){const result=await api('/login',{method:'POST',body:JSON.stringify({username,password})});try{sessionStorage.setItem(key,result.token);}catch{throw new Error('Enable browser session storage to sign in.');}}
export async function logout(){try{await api('/logout',{method:'POST'});}finally{clearSession();}}
