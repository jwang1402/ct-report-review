import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {expect,it,vi} from 'vitest';
import {useStudyData} from '../services/blindStudy';
import {blankCase,type Configuration} from '../services/studyB';
import {caseIds} from '../services/studyBImport';
import {StudyBInventory} from './StudyBInventory';

vi.mock('../services/blindStudy',()=>({useStudyData:vi.fn()}));

const cases=caseIds.map((id,i)=>({...blankCase(id),drive_url:'https://drive.google.com/file/d/ExampleFile'+id+'/view',
  sha256:i.toString(16).padStart(64,'0'),size:100,draft:'Example model draft.'}));

function render(rows:Configuration['cases'],status:Configuration['status']='draft') {
  vi.mocked(useStudyData).mockReturnValue({data:{version:1,status,cases:rows},refresh:vi.fn()});
  return renderToStaticMarkup(<MemoryRouter><StudyBInventory/></MemoryRouter>);
}

it('shows ten saved CTs with drafts as uploaded even before reference preparation and reader release',()=>{
  const draft=render(cases);
  expect(draft).toContain('Upload complete');
  expect(draft).toContain('Not open to readers');
  expect(draft).toContain('/admin/upload?study=B&amp;case=B05');
  expect(render(cases,'frozen')).toContain('Open to readers');
});

it('does not count saved rows with missing image identity, CT link or model draft as uploaded',()=>{
  const partial=render([cases[0],{...cases[1],drive_url:''},{...cases[2],size:0},{...cases[3],sha256:'invalid'},{...cases[4],draft:'  '}]);
  expect(partial).toContain('1 / 10 cases uploaded');
  expect(partial).toContain('View saved cases (5)');
  expect(partial.match(/>Incomplete</g)).toHaveLength(4);
  expect(partial).not.toContain('Upload complete');
  expect(partial).not.toContain(cases[0].draft);
});
