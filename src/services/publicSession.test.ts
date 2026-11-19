import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {exportBlindResults,type StudyResult} from './blindStudy';

const saved=new Map<string,string>();
const location={hash:'#/doctor'};

beforeEach(()=>{
  saved.clear();
  location.hash='#/doctor';
  vi.resetModules();
  vi.stubEnv('VITE_REVIEW_API_URL','https://api.example.test');
  vi.stubGlobal('sessionStorage',{getItem:(s:string)=>saved.get(s)??null,setItem:(k:string,v:string)=>saved.set(k,v),removeItem:(k:string)=>saved.delete(k)});
  vi.stubGlobal('window',{location,dispatchEvent:vi.fn()});
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

it('retries an interrupted public entry under the same private key and isolates the administrator session',async()=>{
  saved.set('ct-review-session','admin-only-token');
  const fetchMock=vi.fn()
    .mockRejectedValueOnce(new Error('Connection interrupted'))
    .mockResolvedValueOnce(Response.json({token:'guest-only-token',username:'guest123',role:'doctor',public_study:'Study',display_name:'Dr Lee'}))
    .mockResolvedValueOnce(Response.json({ok:true}));
  vi.stubGlobal('fetch',fetchMock);
  const {joinReview,sessionToken,logout}=await import('./session');
  await expect(joinReview('Study','Dr Lee')).rejects.toThrow('Connection interrupted');
  await expect(joinReview('Study','Dr Lee')).resolves.toMatchObject({display_name:'Dr Lee'});
  expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
  expect(fetchMock.mock.calls[1][1].headers.has('Authorization')).toBe(false);
  expect(saved.has('ct-review-pending-reader')).toBe(false);
  expect(sessionToken()).toBe('guest-only-token');
  location.hash='#/admin/readers'; expect(sessionToken()).toBe('admin-only-token');
  location.hash='#/doctor'; await logout(); expect(sessionToken()).toBe('');
  expect(saved.get('ct-review-session')).toBe('admin-only-token');
});

it('exports the entered name and the individual reviewer identifier and keeps spreadsheet formulas inert',()=>{
  const row:StudyResult={case_id:'Case01',username:'guest-one',display_name:'=test',letter:'A',model_name:'method',rating:4,comment:'',updated_at:null};
  const csv=exportBlindResults([row]);
  expect(csv).toContain('"username","display_name"');
  expect(csv).toContain('"guest-one","\'=test"');
});
