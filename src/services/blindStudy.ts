import {useEffect,useState, useCallback} from 'react';
import {api} from './session';
import {message} from '../utils';

export interface StudyListItem {case_id:string; case_name:string; scored:boolean;}
export type Letter='A'|'B'|'C'|'D';
export interface ReaderReport {letter:Letter; text:string; rating:number|null; comment:string;}
export interface NamedReport {model_name:string; text:string; letter?:Letter;}
export interface StudyDetail {
  case_id:string;
  case_name:string;
  revision?:string;
  public_ct?:boolean;
  imaging:{type:'NIFTI';filename:string;size:number;drive_url?:string;sha256?:string};
  reports:(ReaderReport|NamedReport)[];
}
export interface StudyResult {
  case_id:string; username:string; display_name?:string|null; letter:Letter; model_name:string;
  rating:number|null; comment:string; updated_at:string|null;
}
export const caseEndpoint=(id:string)=>'/blind/cases/'+encodeURIComponent(id);

export function useStudyData<T>(path:string) {
  const [refreshKey,setRefreshKey]=useState(0);
  const [state,setState]=useState<{path:string;data?:T;error?:string}>({path});
  const refresh=useCallback(()=>setRefreshKey(k=>k+1),[]);
  useEffect(()=>{
    let active=true;
    const abort=new AbortController();
    setState({path});
    api(path,{signal:abort.signal}).then(data=>{
      if(active)setState({path,data});
    }).catch(e=>{if(active)setState({path,error:message(e)});});
    return ()=>{active=false;abort.abort();};
  },[path,refreshKey]);
  return {...(state.path===path?state:{}),refresh};
}

export function exportBlindResults(rows:StudyResult[]) {
  const columns:(keyof StudyResult)[]=['case_id','username','display_name','letter','model_name','rating','comment','updated_at'];
  const escape=(value:unknown)=>{
    let text=String(value??'');
    if(/^\s*[=+@-]|^[\t\r]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  return '\ufeff'+[columns,...rows.map(row=>columns.map(key=>row[key]))]
    .map(cells=>cells.map(escape).join(',')).join('\r\n');
}
