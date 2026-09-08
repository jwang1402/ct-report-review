const scope='https://www.googleapis.com/auth/drive.file';
const clientId=import.meta.env.VITE_GOOGLE_CLIENT_ID as string|undefined;
const pickerKey=import.meta.env.VITE_GOOGLE_PICKER_KEY as string|undefined;
// Google's browser libraries are loaded on demand; tokens stay in module memory.
type GoogleWindow=Window & {google:any;gapi:any};
const googleWindow=()=>window as unknown as GoogleWindow;
let token='',expires=0,loading:Promise<void>|undefined;
export const driveUploadConfigured=Boolean(clientId&&pickerKey);
function script(src:string){return new Promise<void>((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.async=true;el.onload=()=>resolve();el.onerror=()=>{el.remove();reject(new Error('Cannot load Google sign-in. Check your network.'));};document.head.append(el);});}
export function loadGoogle(){return loading??=(async()=>{await Promise.all([script('https://accounts.google.com/gsi/client'),script('https://apis.google.com/js/api.js')]);await new Promise<void>((resolve,reject)=>googleWindow().gapi.load('picker',{callback:resolve,onerror:()=>reject(new Error('Google folder selector could not load.'))}));})().catch(e=>{loading=undefined;throw e;});}
export function authorizeDrive(){return new Promise<void>((resolve,reject)=>{
 if(!clientId)return reject(new Error('Google OAuth client is not configured yet.'));
 const g=googleWindow().google;
 g.accounts.oauth2.initTokenClient({client_id:clientId,scope,include_granted_scopes:false,callback:(r:any)=>{if(r.error||!r.access_token||!g.accounts.oauth2.hasGrantedAllScopes(r,scope))return reject(new Error('Google Drive access was not granted.'));token=r.access_token;expires=Date.now()+Number(r.expires_in)*1000-60000;resolve();},error_callback:()=>reject(new Error('Google sign-in was cancelled or the popup was blocked.'))}).requestAccessToken({prompt:'select_account'});
});}
export function disconnectDrive(){token='';expires=0;}
function access(){if(!token||Date.now()>=expires)throw new Error('Google authorization expired. Connect Google Drive again, then resume.');return token;}
export function selectDriveFolder(){return new Promise<{id:string;name:string}>((resolve,reject)=>{
 const p=googleWindow().google.picker;
 const view=new p.DocsView(p.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder');
 new p.PickerBuilder().addView(view).setOAuthToken(access()).setDeveloperKey(pickerKey).setAppId(clientId!.split('-')[0]).setOrigin(location.origin).setTitle('Select your CT upload folder').setCallback((d:any)=>{if(d.action===p.Action.PICKED){const f=d.docs[0];resolve({id:f.id,name:f.name});}else if(d.action===p.Action.CANCEL)reject(new Error('Folder selection cancelled.'));}).build().setVisible(true);
});}
async function request(url:string,init:RequestInit={}){return fetch(url,{...init,credentials:'omit',headers:{...init.headers,Authorization:'Bearer '+access()}});}
async function checked(r:Response){if(!r.ok){if(r.status===401)throw new Error('Google authorization expired. Reconnect and resume.');throw new Error(`Drive request failed (${r.status}). Check folder access and available storage, then retry.`);}return r;}
export async function verifyFolder(id:string){const r=await checked(await request(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,capabilities(canAddChildren)&supportsAllDrives=true`));const f=await r.json();if(f.mimeType!=='application/vnd.google-apps.folder'||!f.capabilities?.canAddChildren)throw new Error('The selected folder does not allow uploads.');return f;}
export interface UploadSession {url?:string;offset:number;fileId?:string}
export function acknowledgedOffset(range:string|null,total:number){if(!range)return 0;const m=/^bytes=0-(\d+)$/.exec(range);if(!m)throw new Error('Invalid Drive upload acknowledgement');const offset=Number(m[1])+1;if(offset>total)throw new Error('Invalid upload offset');return offset;}
export async function uploadDriveBlob(blob:Blob,name:string,folder:string,session:UploadSession,progress:(n:number)=>void,signal:AbortSignal){
 if(session.fileId)return session.fileId;
 if(!session.url){const r=await checked(await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size&supportsAllDrives=true',{method:'POST',signal,headers:{'Content-Type':'application/json','X-Upload-Content-Type':blob.type||'application/octet-stream','X-Upload-Content-Length':String(blob.size)},body:JSON.stringify({name,parents:[folder]})}));const url=r.headers.get('Location');if(!url||new URL(url).origin!=='https://www.googleapis.com')throw new Error('Drive did not return a usable upload session.');session.url=url;}
 let probe=true,failures=0;
 while(!session.fileId){
  signal.throwIfAborted();const start=session.offset,end=Math.min(start+8*1024**2,blob.size);
  try{
   const r=await request(session.url,{method:'PUT',signal,headers:{'Content-Type':blob.type||'application/octet-stream','Content-Range':probe?`bytes */${blob.size}`:`bytes ${start}-${end-1}/${blob.size}`},body:probe?new Blob([]):blob.slice(start,end)});
   if(r.status===200||r.status===201){const file=await r.json();if(!file.id||Number(file.size)!==blob.size)throw new Error('Drive uploaded file size does not match.');session.fileId=file.id;progress(blob.size);break;}
   if(r.status===308){const offset=acknowledgedOffset(r.headers.get('Range'),blob.size);if(!probe&&offset<=start)throw new Error('Drive did not acknowledge the uploaded chunk.');session.offset=offset;progress(offset);probe=false;failures=0;continue;}
   if(r.status===404||r.status===410){session.url=undefined;session.offset=0;throw new Error('Upload session expired. Retry to start a new session.');}
   if(r.status===429||r.status>=500)throw new Error('Temporary Drive upload error.');
   await checked(r);
  }catch(e){if(signal.aborted)throw e;if(++failures>3||!session.url||Date.now()>=expires)throw e;probe=true;await new Promise<void>((resolve,reject)=>{const onAbort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},1000*2**failures);signal.addEventListener('abort',onAbort,{once:true});});}
 }
 return session.fileId!;
}
export async function shareUploadedFile(id:string){await checked(await request(`https://www.googleapis.com/drive/v3/files/${id}/permissions?supportsAllDrives=true`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'anyone',role:'reader',allowFileDiscovery:false})}));}
