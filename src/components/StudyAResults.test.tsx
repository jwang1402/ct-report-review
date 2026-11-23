import {expect,it} from 'vitest';
import {matchedModelResults,studyAProgress,studyAExport} from './StudyAResults';
import {findings,type FindingMap} from '../services/studyAReview';
import type {ExpertReference} from './StudyAReference';

const assignments=['Case01','Case02'].flatMap(case_id=>['A','B','C'].map(letter=>({case_id,letter,model_name:'model-'+letter})));
const reader={username:'reader01',display_name:'Reader',version:'v1',case_ids:['Case01','Case02']};
const rows=assignments.slice(0,4).map(a=>({...a,username:reader.username,display_name:reader.display_name,mode:'no' as const,
  rating:5,comment:'+example',confirmed:true as const,errors:[],updated_at:'2026-01-01T00:00:00Z',checklist_version:'example-release'}));
it('exports reference-matched findings without treating a missing reference or an indeterminate label as an absence',()=>{
  const map=Object.fromEntries(findings.map(f=>[f,0])) as FindingMap;
  map.emphysema=1;
  const decisions=Object.fromEntries(findings.map(f=>[f,{status:'absent',side:''}])) as ExpertReference['findings'];
  decisions.consolidation={status:'present',side:'left'};
  decisions.cardiomegaly={status:'indeterminate',side:''};
  const r={...rows[0],findings:map};
  const ref={case_id:r.case_id,version:1,expert:'Reviewer',notes:'',findings:decisions};
  expect(studyAExport([r],false,'findings')).toContain('reference_pending');
  const output=studyAExport([r],false,'findings',[ref]);
  expect(output.split('\r\n')).toHaveLength(19);
  expect(output).toContain('"Emphysema","1","absent","","1","unsupported"');
  expect(output).toContain('"Consolidation","0","present","left","1","missed"');
  expect(output).toContain('"Cardiomegaly","0","indeterminate","","1","indeterminate"');
});
it('counts three saved reports as a complete Study A case and includes unsaved eligible cases',()=>{
  expect(studyAProgress(reader,rows,assignments)).toEqual({reports:4,total:6,completed:1,cases:2});
  expect(studyAProgress({...reader,username:'new'},rows,assignments)).toEqual({reports:0,total:6,completed:0,cases:2});
});
it('compares only complete sets of three reports rated by the same reader on the same case',()=>{
  const partialOtherReader={...rows[3],username:'other-reader',model_name:'model-B'};
  const matched=matchedModelResults([...rows,partialOtherReader]);
  expect(matched.map(r=>[r.cases,r.reviews,r.quality])).toEqual([[1,1,5],[1,1,5],[1,1,5]]);
});
it('exports a row for every submitted review including zero-error records; reveal controls the model key',()=>{
  const blind=studyAExport(rows,false,'reviews');
  expect(blind).toContain('"overall_quality"');
  expect(blind).toContain('"checklist_version"');expect(blind).toContain('"example-release"');
  expect(blind).not.toContain('model-A');expect(blind).toContain('"\'+example"');
  expect(blind.split('\r\n')).toHaveLength(5);
  expect(studyAExport(rows,true,'reviews')).toContain('model-A');
});
it('exports multiple error events from the same finding, with separate severity and free-text details',()=>{
  const r={...rows[0],mode:'yes' as const,errors:[{finding:'other',other:'Mass',type:'missed' as const,significant:true,detail:'Left lobe'},
    {finding:'other',other:'Mass',type:'location' as const,significant:false,detail:'Different lesion'}]};
  const errors=studyAExport([r],false,'errors');
  expect(errors.split('\r\n')).toHaveLength(3);
  expect(errors).toContain('"Mass","Missed finding","1","Left lobe"');
  expect(errors).toContain('"Mass","Incorrect location / laterality","0","Different lesion"');
  expect(studyAExport([r],false,'reviews')).toContain('"yes","2","1","1"');
});
