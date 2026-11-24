import {findings, type Finding} from './studyAReview';

export type Side='left'|'right'|'bilateral'|'unspecified'|'na';
export type FindingRecord=Partial<Record<Finding,{present:boolean;side:Side}>>;
export type Condition='with_ai'|'without_ai';
export type StudyBList={
  status:'not_ready'|'ready'|'washout'|'confirm_name'|'complete';
  period:number;opens_at:string|null;cases:{case_id:string;submitted:boolean;started:boolean}[]
};
export type Reading={
  case_id:string;period:number;condition:Condition;imaging:{drive_url:string;sha256:string;size:number};
  started_at:string;version:number;report:string;findings:FindingRecord;draft?:string
};
export type CaseEntry={id:string;description:string};
export type CaseConfig={case_id:string;drive_url:string;sha256:string;size:number;draft:string;reference:string;
  reference_findings:CaseEntry[];draft_errors:CaseEntry[];reference_version?:number;reference_locked?:boolean};
export type Configuration={version:number;status:'draft'|'frozen';cases:CaseConfig[]};
export type RecordedError={finding:string;reference_id?:string;type:'missed'|'unsupported'|'location'|'other';significant:boolean;detail:string};
export type Assessment={version:number;errors:RecordedError[];accepted_draft_errors:string[]};
export type ResultReading={
  username:string;display_name:string;cohort:'junior'|'senior';case_id:string;period:number;condition:Condition;version:number;
  started_at:string;submitted_at:string|null;elapsed_seconds:number|null;report:string;findings:FindingRecord;
  draft?:string;reference:string;draft_errors:CaseEntry[];assessment:Assessment|null
};
export type Results={readings:ResultReading[];cases:CaseConfig[]};
export const sideLabels:Record<Side,string>={left:'Left',right:'Right',bilateral:'Bilateral',unspecified:'Unspecified',na:'Not applicable'};
export const errorLabels:Record<RecordedError['type'],string>={missed:'Missed finding',unsupported:'Unsupported finding',location:'Incorrect location / laterality',other:'Other description error'};
export function missingReading(report:string,answers:FindingRecord) {
  if(!report.trim())return 'Enter a final report before submitting.';
  if(findings.some(f=>!answers[f]))return 'Record each finding as present or absent before submitting.';
  return '';
}
export function fillUnanswered(answers:FindingRecord):FindingRecord {
  const filled={...answers};
  for(const f of findings)if(!filled[f])filled[f]={present:false,side:'na'};
  return filled;
}
export function sessionDate(value:string|null) {
  return value ? new Date(value).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}) : '';
}
export function blankCase(id:string):CaseConfig {
  return {case_id:id,drive_url:'',sha256:'',size:0,draft:'',reference:'',reference_findings:[],draft_errors:[]};
}
