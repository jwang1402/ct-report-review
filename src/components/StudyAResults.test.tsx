import {expect,it} from 'vitest';
import {studyAProgress,studyAExport} from './StudyAResults';

const assignments=['Case01','Case02'].flatMap(case_id=>['A','B','C'].map(letter=>({case_id,letter,model_name:'model-'+letter})));
const reader={username:'reader01',display_name:'Reader',version:'v1',case_ids:['Case01','Case02']};
const rows=assignments.slice(0,4).map(a=>({...a,username:reader.username,display_name:reader.display_name,mode:'no' as const,
  rating:5,comment:'+example',confirmed:true as const,errors:[],updated_at:'2026-01-01T00:00:00Z'}));
it('counts three saved reports as a complete Study A case and includes unsaved eligible cases',()=>{
  expect(studyAProgress(reader,rows,assignments)).toEqual({reports:4,total:6,completed:1,cases:2});
  expect(studyAProgress({...reader,username:'new'},rows,assignments)).toEqual({reports:0,total:6,completed:0,cases:2});
});
it('exports a row for every submitted review including zero-error records; reveal controls the model key',()=>{
  const blind=studyAExport(rows,false,'reviews');
  expect(blind).toContain('"overall_quality"');
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
