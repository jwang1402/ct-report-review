import {describe,expect,it} from 'vitest';
import {fillUnanswered,missingReading,blankCase,type FindingRecord} from './studyB';
import {caseIds,readConfiguration} from './studyBImport';
import {studyImagePath} from './publicDriveMedia';

describe('Study B reports',()=>{
  it('requires a report and all 18 explicit decisions',()=>{
    const answers:FindingRecord={pleural_effusion:{present:true,side:'left'}};
    expect(missingReading('Left pleural effusion.',answers)).not.toBe('');
    const complete=fillUnanswered(answers);
    expect(Object.keys(complete)).toHaveLength(18);
    expect(complete.pleural_effusion).toEqual({present:true,side:'left'});
    expect(complete.lung_nodule).toEqual({present:false,side:'na'});
    expect(Object.keys(answers)).toHaveLength(1);
    expect(missingReading('  ',complete)).not.toBe('');
    expect(missingReading('Left pleural effusion.',complete)).toBe('');
  });
  it('uses the authorized case image route for each study',()=>{
    expect(studyImagePath('B01',true)).toBe('/study-b/cases/B01/image');
    expect(studyImagePath('A01',false)).toBe('/blind/cases/A01/image');
  });
});

describe('Study B case configuration',()=>{
  it('roundtrips independently adjudicated findings and fixed draft errors',()=>{
    const rows=caseIds.map(blankCase);
    rows[0].reference_findings=[{id:'f1',description:'Right effusion'}];
    rows[0].draft_errors=[{id:'e1',description:'Omitted effusion'}];
    expect(readConfiguration('\uFEFF'+JSON.stringify({cases:rows}))).toEqual(rows);
  });
  it('rejects duplicate or foreign cases, invalid file sizes and malformed references',()=>{
    const row=blankCase('B01');
    for(const rows of [[row,row],[{...row,case_id:'A01'}],[{...row,size:-2}],[{...row,reference_findings:[null]}]]){
      expect(()=>readConfiguration(JSON.stringify(rows))).toThrow();
    }
  });
});
