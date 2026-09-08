export const apiBase=(import.meta.env.VITE_REVIEW_API_URL as string|undefined)?.replace(/\/$/,'');
const key='ct-review-session';
export function sessionToken(){try{return sessionStorage.getItem(key)||'';}catch{return '';}}
export function clearSession(){try{sessionStorage.removeItem(key);}catch{}window.dispatchEvent(new Event('ct-session-ended'));}
export async function api(path:string,init:RequestInit={}){if(!apiBase)throw new Error('The login service is not configured yet.');const response=await fetch(apiBase+path,{...init,credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json',...init.headers,...(sessionToken()?{Authorization:'Bearer '+sessionToken()}:{})},signal:init.signal||AbortSignal.timeout(20000)});let result;try{result=await response.json();}catch{throw new Error('Cannot reach the login service. Please retry.');}if(!response.ok){if(response.status===401)clearSession();throw new Error(result.error||'Request failed.');}return result;}
export async function login(username:string,password:string){const result=await api('/login',{method:'POST',body:JSON.stringify({username,password})});try{sessionStorage.setItem(key,result.token);}catch{throw new Error('Enable browser session storage to sign in.');}}
export async function logout(){try{await api('/logout',{method:'POST'});}finally{clearSession();}}
