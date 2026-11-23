import {useState,type FormEvent} from 'react';
import {findings,findingNames,type Finding} from '../services/studyAReview';
import {api} from '../services/session';
import {message} from '../utils';

export type Decision={status:'present'|'absent'|'indeterminate';side:string};
export type ExpertReference={case_id:string;version:number;expert:string;findings:Record<Finding,Decision>;notes:string};
type Props={cases:string[];references:ExpertReference[];refresh:()=>void};

function ReferenceForm({id,saved,refresh}:{id:string;saved?:ExpertReference;refresh:()=>void}) {
  const [expert,setExpert]=useState(saved?.expert??'');
  const [notes,setNotes]=useState(saved?.notes??'');
  const [choices,setChoices]=useState<Partial<Record<Finding,Decision>>>(saved?.findings??{});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(e:FormEvent) {
    e.preventDefault();setBusy(true);setError('');
    try{
      await api('/admin/study-a-references',{method:'PUT',body:JSON.stringify({case_id:id,version:saved?.version??0,expert,findings:choices,notes})});
      refresh();
    }catch(e){setError(message(e));}finally{setBusy(false);}
  }
  const missing=findings.filter(f=>!choices[f]);
  return <form onSubmit={save}>
    <label>Independent reviewer or reference source<input value={expert} required maxLength={160} onChange={e=>setExpert(e.target.value)}/></label>
    <div className="section-heading"><h3>Reference findings</h3><button className="button secondary" type="button" disabled={!missing.length}
      onClick={()=>setChoices({...choices,...Object.fromEntries(missing.map(f=>[f,{status:'absent',side:''}]))})}>Mark remaining absent</button></div>
    <div className="table-scroll"><table><thead><tr><th>Finding</th><th>Reference</th><th>Side</th></tr></thead>
    <tbody>{findings.map(f=>{
      const choice=choices[f];
      return <tr key={f}><td>{findingNames[f]}</td><td><select aria-label={findingNames[f]+' reference'} required value={choice?.status??''}
        onChange={e=>setChoices({...choices,[f]:{status:e.target.value as Decision['status'],side:''}})}>
        <option value="" disabled>Select…</option><option value="present">Present</option><option value="absent">Absent</option><option value="indeterminate">Indeterminate</option>
      </select></td><td>{choice?.status==='present'?<select aria-label={findingNames[f]+' side'} value={choice.side}
        onChange={e=>setChoices({...choices,[f]:{...choice,side:e.target.value}})}>
        <option value="">Select if applicable</option>{['left','right','bilateral','midline','unspecified','not_applicable'].map(side=><option key={side} value={side}>{side.replace('_',' ')}</option>)}
      </select>:'—'}</td></tr>;
    })}</tbody></table></div>
    <label>Other important findings or notes<textarea maxLength={4000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    {error&&<p className="error" role="alert">{error}</p>}
    <button className="button primary" disabled={busy||!!missing.length||!expert.trim()}>{busy?'Saving…':'Save reference'}</button>
  </form>;
}

export function StudyAReference({cases,references,refresh}:Props) {
  const [selected,setSelected]=useState('');
  const id=cases.includes(selected)?selected:cases[0];
  const saved=references.find(r=>r.case_id===id);
  return <details className="work-card results-group">
    <summary>Independent case references · {references.length} / {cases.length}</summary>
    {id&&<><label>Case<select value={id} onChange={e=>setSelected(e.target.value)}>
      {cases.map(c=><option key={c} value={c}>{c.split('-').at(-1)}</option>)}
    </select></label><p className="muted">{saved?'Saved reference · revision '+saved.version:'No reference saved for this case.'}</p>
    <ReferenceForm key={id+'/'+(saved?.version??0)} id={id} saved={saved} refresh={refresh}/></>}
  </details>;
}
