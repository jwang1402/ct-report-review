import {useState} from 'react';
import {Trash2} from 'lucide-react';
import type {CaseRelease} from '../types';
import {repositoryUrl,githubConfig} from '../config';
export function RemoveCase({item}:{item:CaseRelease}){
 const [open,setOpen]=useState(false),[confirmation,setConfirmation]=useState('');
 const body=JSON.stringify({schema:'ct-remove-v1',case_id:item.case_id,release_id:item.release_id});
 const url=`${repositoryUrl}/issues/new?${new URLSearchParams({title:`[CT-REMOVE] ${item.case_id}`,body})}`;
 return <><button className="icon-button" aria-label={`Remove case ${item.case_id}`} title="Remove case from website" onClick={()=>{setConfirmation('');setOpen(true);}}><Trash2 size={16}/></button>{open&&<div className="remove-backdrop"><section role="dialog" aria-modal="true" aria-labelledby={`remove-${item.release_id}`} className="form-card remove-dialog"><h2 id={`remove-${item.release_id}`}>Remove case from website</h2><p><strong>{item.case_name}</strong> · {item.case_id}</p><p>This removes the case from the shared case library after deployment. Original CT files, reports and submitted reviews are retained.</p><p>Only repository owner <strong>@{githubConfig.owner}</strong> can authorize this operation. On GitHub, click Create to submit it; other users’ requests do not remove cases.</p><label>Type the case ID to continue<input autoFocus value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/></label><div className="actions"><button className="button secondary" onClick={()=>setOpen(false)}>Cancel</button>{confirmation===item.case_id?<a className="button primary" href={url} target="_blank" rel="noreferrer">Continue on GitHub</a>:<button className="button primary" disabled>Continue on GitHub</button>}</div><small>Wait for “Remove case from website” and the deployment workflow to complete, then refresh cases.</small></section></div>}</>;
}
