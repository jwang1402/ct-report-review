import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import {useStudyData} from '../services/blindStudy';
import {blankCase,type CaseConfig,type Configuration,type ResultReading} from '../services/studyB';
import {caseIds} from '../services/studyBImport';
import StudyBAdmin,{StudyBConfiguration} from './StudyBAdmin';

vi.mock('../services/blindStudy',()=>({useStudyData:vi.fn()}));
const cases=caseIds.map((id,i)=>({...blankCase(id),drive_url:'https://drive.google.com/file/d/Synthetic'+id+'/view',
  size:150,sha256:i.toString(16).padStart(64,'0'),draft:'Draft '+id}));

function editor(status:Configuration['status'],rows:CaseConfig[]=cases){
  vi.mocked(useStudyData).mockReturnValue({data:{status,cases:rows,version:2},refresh:vi.fn()});
  return renderToStaticMarkup(<MemoryRouter><StudyBConfiguration active driveBusy={false} setDriveBusy={()=>{}}/></MemoryRouter>);
}
it('allows opening with ten CTs and drafts while references are blank',()=>{
  const html=editor('draft');
  expect(html).toMatch(/<button[^>]*class="button primary"[^>]*>(?:(?!<\/button>)[\s\S])*Open Study B to readers/);
  expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*Open Study B to readers/);
  expect(editor('draft',cases.slice(1))).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>)[\s\S])*Open Study B to readers/);
});
it('keeps the image and model draft fixed and only locks the reference for assessed cases',()=>{
  const open=editor('frozen');
  expect(open).toMatch(/MORPH-CT draft<textarea[^>]*readOnly=""/);
  expect(open).toMatch(/Independent expert reference<textarea(?![^>]*readOnly)[^>]*><\/textarea>/);
  expect(open).toContain('Save reference');
  const assessed=editor('frozen',cases.map(c=>({...c,reference:'Expert opinion',reference_locked:true})));
  expect(assessed).toMatch(/Independent expert reference<textarea[^>]*readOnly=""/);
  expect(assessed).not.toContain('Save reference');
});
it('routes unreferenced submitted cases to the expert reference editor before assessment',()=>{
  const example:ResultReading={case_id:'B01',username:'reader01',display_name:'Reader',cohort:'senior',period:1,
    condition:'without_ai',started_at:'2026-01-01',submitted_at:'2026-01-02',elapsed_seconds:60,
    report:'Submitted report',findings:{},reference:'',draft_errors:[],assessment:null};
  function results(reference:string) {
    vi.mocked(useStudyData).mockReturnValue({data:{cases:[{...cases[0],reference}],readings:[{...example,reference}]},refresh:vi.fn()});
    return renderToStaticMarkup(<MemoryRouter><StudyBAdmin/></MemoryRouter>);
  }
  expect(results('')).toContain('/admin/upload?study=B&amp;case=B01');
  expect(results('')).not.toContain('Assess reading');
  expect(results('Expert findings')).toContain('Assess reading');
});
