import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {exportBlindResults,type StudyResult} from './blindStudy';

const saved=new Map<string,string>();
const location={hash:'#/radiologists'};

beforeEach(()=>{
  saved.clear();
  location.hash='#/radiologists';
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
  location.hash='#/radiologists/cases/Study-Case01'; await logout(); expect(sessionToken()).toBe('');
  expect(saved.get('ct-review-session')).toBe('admin-only-token');
});

it('uses separate reader and admin routes and rejects retired reader links',async()=>{
  const {workspaceHome,workspaceRole}=await import('./session');
  expect(workspaceHome('doctor')).toBe('/radiologists');
  expect(workspaceHome('admin')).toBe('/admin');
  for(const suffix of ['', '/account', '/cases/Study-Case01']){
    expect(workspaceRole('/radiologists'+suffix)).toBe('doctor');
    expect(workspaceRole('/doctor'+suffix)).toBeNull();
  }
  expect(workspaceRole('/admin/cases/Study-Case01')).toBe('admin');
  expect(workspaceRole('/radiologists-extra')).toBeNull();
});

it('recognizes a returning reader from the name-only form and forgets the device on explicit sign-out',async()=>{
  location.hash='#/junior';
  const browser=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(k:string)=>browser.get(k)??null,setItem:(k:string,v:string)=>browser.set(k,v),removeItem:(k:string)=>browser.delete(k)});
  const requests:{name?:string;entry_key?:string}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    if(url.endsWith('/logout'))return Response.json({ok:true});
    requests.push(JSON.parse(String(init.body)));
    return Response.json(requests.length===3?{pending:true,request_code:'link-code'}:{token:'test-session',role:'doctor',cohort:'junior',display_name:'Dr Lee'});
  }));
  const {enterReader,logout}=await import('./session');
  await enterReader('junior','Dr Lee');
  saved.clear();
  await enterReader('junior','Dr Lee');
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).not.toHaveProperty('returning');
  await logout();
  expect(browser.size).toBe(0);
  await expect(enterReader('junior','Dr Lee')).resolves.toEqual({request_code:'link-code'});
  expect(requests[2].entry_key).not.toBe(requests[0].entry_key);
  expect(saved.has('ct-crossover-session:junior')).toBe(false);
});

it('exports the entered name and the individual reviewer identifier and keeps spreadsheet formulas inert',()=>{
  const row:StudyResult={case_id:'Case01',username:'guest-one',display_name:'=test',letter:'A',model_name:'method',rating:4,comment:'',updated_at:null};
  const csv=exportBlindResults([row]);
  expect(csv).toContain('"username","display_name"');
  expect(csv).toContain('"guest-one","\'=test"');
});
