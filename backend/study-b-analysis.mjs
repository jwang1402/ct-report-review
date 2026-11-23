import {findings} from './study-a.mjs';

const ratio=(a,b)=>b?a/b:null;
const sum=values=>values.reduce((a,b)=>a+b,0);
function median(values) {
  if(!values.length)return null;
  const sorted=values.slice().sort((a,b)=>a-b), mid=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
}

// For each case/finding, all three juniors contribute a decision. Undefined
// kappa (when all decisions occupy a single category) stays null.
function agreement(triplets) {
  const marginal=new Map();let allAgree=0,matchedPairs=0;
  for(const values of triplets){
    const [a,b,c]=values;
    if(a===b&&b===c)allAgree++;
    matchedPairs+=Number(a===b)+Number(a===c)+Number(b===c);
    for(const item of values)marginal.set(item,(marginal.get(item)??0)+1);
  }
  const n=triplets.length,observed=ratio(matchedPairs,3*n);
  const chance=sum([...marginal.values()].map(x=>(x/(n*3))**2));
  return {items:n,unanimous:allAgree,unanimous_fraction:ratio(allAgree,n),pairwise_agreement:observed,
    fleiss_kappa:observed!=null&&chance<1?(observed-chance)/(1-chance):null};
}
function accuracy(rows) {
  let missed=0,correct=0,total=0,significant=0,wrongLocation=0,unsupported=0,accepted=0,offered=0;
  for(const r of rows){
    const missedIds=new Set(),incorrectIds=new Set();
    const errors=r.assessment.errors;
    for(const e of errors){
      if(e.significant)significant++;
      if(e.type==='location')wrongLocation++;
      if(e.type==='unsupported')unsupported++;
      if(e.type==='missed')missedIds.add(e.reference_id);
      if(e.reference_id && e.type!=='unsupported')incorrectIds.add(e.reference_id);
    }
    missed+=missedIds.size;
    total+=r.reference_findings.length;
    correct+=r.reference_findings.length-incorrectIds.size;
    if(r.condition==='with_ai'){
      accepted+=r.assessment.accepted_draft_errors.length;
      offered+=r.draft_errors.length;
    }
  }
  return {assessed_reports:rows.length,clinically_significant_errors:significant,significant_errors_per_report:ratio(significant,rows.length),
    key_finding_opportunities:total,missed_key_findings:missed,missed_fraction:ratio(missed,total),correct_key_findings:correct,correct_fraction:ratio(correct,total),
    location_errors:wrongLocation,location_errors_per_report:ratio(wrongLocation,rows.length),unsupported_findings:unsupported,
    accepted_draft_errors:accepted,draft_error_opportunities:offered,accepted_fraction:ratio(accepted,offered)};
}

export function summarizeStudyB(readings,cases,selection=null) {
  const submitted=readings.filter(r=>r.submitted_at!=null);
  const readerIds=(rows,cohort)=>[...new Set(rows.filter(r=>r.cohort===cohort).map(r=>r.username))];
  const activeJuniors=readerIds(submitted,'junior'),activeSeniors=readerIds(submitted,'senior');
  const juniors=selection?.juniors??(activeJuniors.length<=3?activeJuniors:[]);
  const seniors=selection?.seniors??(activeSeniors.length<=2?activeSeniors:[]);
  const roster={
    juniors,seniors,explicit:!!selection,selection_required:!selection&&(activeJuniors.length>3||activeSeniors.length>2),
    first_period_by_case:cases.map(c=>{
      const first=readings.filter(r=>r.case_id===c.case_id&&r.period===1&&juniors.includes(r.username));
      return {case_id:c.case_id,with_ai:first.filter(r=>r.condition==='with_ai').length,without_ai:first.filter(r=>r.condition==='without_ai').length};
    })
  };
  const completed=submitted.filter(r=>r.cohort==='junior'?juniors.includes(r.username):seniors.includes(r.username));
  const paired=[],mixedCases=[],groupCases=[], byFinding={};
  for(const c of cases){
    const rows=completed.filter(r=>r.case_id===c.case_id);
    const assisted=rows.filter(r=>r.cohort==='junior'&&r.condition==='with_ai');
    const unaided=rows.filter(r=>r.cohort==='junior'&&r.condition==='without_ai');
    for(const a of assisted){
      const b=unaided.find(r=>r.username===a.username);
      if(b)paired.push({a,b});
    }
    if(juniors.length===3 && assisted.length===3 && unaided.length===3)mixedCases.push({assisted,unaided});
    const senior=rows.filter(r=>r.cohort==='senior'&&r.condition==='without_ai'&&r.assessment);
    if(juniors.length===3&&seniors.length===2&&assisted.length===3&&assisted.every(r=>r.assessment)&&senior.length===2)groupCases.push({assisted,senior});
  }
  const pooled={assisted:[],unaided:[]},sides={assisted:[],unaided:[]};
  for(const name of findings){
    const data={assisted:[],unaided:[]};
    for(const c of mixedCases){
      const items=[...c.assisted,...c.unaided].map(r=>r.findings[name]);
      const sideKnown=items.every(v=>v?.present&&['left','right','bilateral'].includes(v.side));
      for(const arm of ['assisted','unaided']){
        const decisions=c[arm].map(r=>r.findings[name].present);
        data[arm].push(decisions);pooled[arm].push(decisions);
        if(sideKnown)sides[arm].push(c[arm].map(r=>r.findings[name].side));
      }
    }
    byFinding[name]={with_ai:agreement(data.assisted),without_ai:agreement(data.unaided)};
  }
  const assessed=paired.filter(p=>p.a.assessment&&p.b.assessment);
  const minutes=(rows)=>rows.map(r=>r.elapsed_seconds/60);
  const withTime=median(minutes(paired.map(p=>p.a))),withoutTime=median(minutes(paired.map(p=>p.b)));
  return {roster,junior_readers_with_started_cases:readerIds(readings,'junior').length,senior_readers_with_started_cases:readerIds(readings,'senior').length,
    agreement:{paired_cases_with_all_three_juniors:mixedCases.length,pooled_case_finding:{with_ai:agreement(pooled.assisted),without_ai:agreement(pooled.unaided)},
      per_finding:byFinding,laterality_all_six_reads_positive_and_side_specified:{with_ai:agreement(sides.assisted),without_ai:agreement(sides.unaided)}},
    paired_junior_errors:{assessed_reader_case_pairs:assessed.length,with_ai:accuracy(assessed.map(p=>p.a)),without_ai:accuracy(assessed.map(p=>p.b))},
    junior_with_ai_vs_senior_without:{cases_with_all_five_assessments:groupCases.length,junior:accuracy(groupCases.flatMap(c=>c.assisted)),
      senior:accuracy(groupCases.flatMap(c=>c.senior))},
    efficiency:{complete_reader_case_pairs:paired.length,with_ai_median_minutes:withTime,without_ai_median_minutes:withoutTime,
      change_in_medians_percent:withoutTime?100*(withTime-withoutTime)/withoutTime:null,
      median_with_minus_without_minutes:median(paired.map(p=>(p.a.elapsed_seconds-p.b.elapsed_seconds)/60)),
      ai_first_pairs:paired.filter(p=>p.a.period===1).length,ai_second_pairs:paired.filter(p=>p.a.period===2).length}};
}
