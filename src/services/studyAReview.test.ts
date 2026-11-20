import {describe,it,expect} from 'vitest';
import {blankReview,reviewProblem,validFindings,findings,type FindingMap,type FindingError} from './studyAReview';
import {studyDisplayName,caseDisplayLabel} from './studyDisplay';

describe('Study A reader review',()=>{
  it('requires an explicit disposition, quality and whole-report confirmation',()=>{
    const d=blankReview();
    expect(reviewProblem(d)).toMatch(/whether/);
    d.mode='no';expect(reviewProblem(d)).toMatch(/quality/);
    d.rating=4;expect(reviewProblem(d)).toMatch(/Confirm/);
    d.confirmed=true;expect(reviewProblem(d)).toBe('');
  });
  it('collects one or more independent errors per affected finding',()=>{
    const d={...blankReview(),mode:'yes' as const,rating:3,confirmed:true};
    expect(reviewProblem(d)).toMatch(/at least one/);
    const row:FindingError={finding:'lung_nodule',other:'',type:'missed',significant:true,detail:'First lesion'};
    d.errors.push(row,{...row,type:'location',detail:'Second lesion'});
    expect(reviewProblem(d)).toBe('');
  });
  it('requires all eighteen numeric decisions to enable a submission',()=>{
    const map=Object.fromEntries(findings.map(f=>[f,0])) as FindingMap;
    expect(validFindings(map)).toBe(true);
    expect(validFindings(null)).toBe(false);
    expect(validFindings({...map,lung_nodule:undefined} as unknown as FindingMap)).toBe(false);
  });
  it('changes the display without changing legacy case IDs or unrelated studies',()=>{
    expect(caseDisplayLabel('BR4shared-Case04')).toBe('Study A · Case04');
    expect(studyDisplayName('BR4shared')).toBe('Study A');
    expect(caseDisplayLabel('Another-Case04')).toBe('Another-Case04');
    expect(caseDisplayLabel('BR4shared-Case11')).toBe('BR4shared-Case11');
  });
});
