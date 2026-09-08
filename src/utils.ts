export function sizeLabel(n:number){return n<1024**2?`${(n/1024).toFixed(1)} KB`:`${(n/1024**2).toFixed(1)} MB`;}
export function saveFile(data:Blob|string,name:string,type='text/plain'){const blob=typeof data==='string'?new Blob([data],{type}):data;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function message(e:unknown){return e instanceof Error?e.message:'Unexpected error. Please try again.';}
