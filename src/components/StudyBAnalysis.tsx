import {useState} from 'react';
import {Download} from 'lucide-react';
import {api} from '../services/session';
import type {ResultReading} from '../services/studyB';
import {message,saveFile} from '../utils';

type Roster = {juniors:string[]; seniors:string[]};
export type StudyBAnalysisData = {
  agreement:{paired_cases_with_all_three_juniors:number};
  paired_junior_errors:{assessed_reader_case_pairs:number};
  junior_with_ai_vs_senior_without:{cases_with_all_five_assessments:number};
  efficiency:{complete_reader_case_pairs:number;with_ai_median_minutes:number|null;without_ai_median_minutes:number|null};
};

export function StudyBAnalysis({readings,overall}:{readings:ResultReading[];overall?:StudyBAnalysisData}) {
  const readers=Array.from(new Map(readings.map(r=>[r.username,r])).values())
    .sort((a,b)=>(a.display_name||a.username).localeCompare(b.display_name||b.username));
  const groups={juniors:readers.filter(r=>r.cohort==='junior'),seniors:readers.filter(r=>r.cohort==='senior')};
  const [roster,setRoster]=useState<Roster>(()=>({
    juniors:groups.juniors.length===3?groups.juniors.map(r=>r.username):[],
    seniors:groups.seniors.length===2?groups.seniors.map(r=>r.username):[]
  }));
  const [result,setResult]=useState<StudyBAnalysisData|null>(null);
  const [pending,setPending]=useState(false);
  const [failure,setFailure]=useState('');
  function select(group:keyof Roster,id:string,checked:boolean){
    setRoster(r=>({...r,[group]:checked?[...r[group],id]:r[group].filter(v=>v!==id)}));
    setResult(null);
    setFailure('');
  }
  async function compute(){
    setPending(true);
    setFailure('');
    try{
      const response=await api('/admin/study-b/analysis',{method:'POST',body:JSON.stringify(roster)});
      setResult(response.analysis);
    }catch(e){setFailure(message(e));}
    finally{setPending(false);}
  }
  const excess=groups.juniors.length>3||groups.seniors.length>2;
  const current=result??(!excess?overall:undefined);
  return <section className="work-card sb-analysis"><h2>Crossover analysis</h2>
    {excess&&<fieldset className="sb-admin-fields" disabled={pending}>
      <legend>Analysis roster</legend>
      <p className="sb-hint">Select the three junior and two senior readers designated for this comparison.</p>
      <div className="sb-admin-grid">{(['juniors','seniors'] as const).map(group=>
        <div key={group}><h3>{group==='juniors'?'Junior readers':'Senior readers'} · {roster[group].length} / {group==='juniors'?3:2}</h3>
          {groups[group].map(r=><label className="sb-checkbox" key={r.username}><input type="checkbox" checked={roster[group].includes(r.username)}
            onChange={e=>select(group,r.username,e.target.checked)}/>{r.display_name||r.username}</label>)}
        </div>)}</div>
      <div><button className="button primary" onClick={()=>void compute()}
        disabled={pending||roster.juniors.length!==3||roster.seniors.length!==2}>{pending?'Calculating…':'Calculate for selected readers'}</button></div>
      {failure&&<p role="alert" className="error">{failure}</p>}
    </fieldset>}
    {current&&<div className="sb-analysis-summary">
      <dl>
        <div><dt>Junior readings paired across both sessions</dt><dd>{current.efficiency.complete_reader_case_pairs}</dd></div>
        <div><dt>Paired junior readings with completed assessments</dt><dd>{current.paired_junior_errors.assessed_reader_case_pairs}</dd></div>
        <div><dt>Cases with complete three-reader agreement data</dt><dd>{current.agreement.paired_cases_with_all_three_juniors}</dd></div>
        <div><dt>Cases assessed across all five readers</dt><dd>{current.junior_with_ai_vs_senior_without.cases_with_all_five_assessments}</dd></div>
        <div><dt>Median reading time · with AI / without AI</dt><dd>{[current.efficiency.with_ai_median_minutes,current.efficiency.without_ai_median_minutes].map(v=>v==null?'—':v.toFixed(1)+' min').join(' / ')}</dd></div>
      </dl>
      <button className="button secondary" onClick={()=>saveFile(JSON.stringify({roster:result?roster:{
        juniors:groups.juniors.map(r=>r.username),seniors:groups.seniors.map(r=>r.username)},analysis:current},null,2),'study-b-analysis.json','application/json')}>
        <Download size={14}/>Export analysis</button>
    </div>}
  </section>;
}
