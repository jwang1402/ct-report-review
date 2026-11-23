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

it('uses the saved browser key and canonical name when a returning reader misspells their name',async()=>{
  location.hash='#/junior';
  const browser=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(k:string)=>browser.get(k)??null,setItem:(k:string,v:string)=>browser.set(k,v),removeItem:(k:string)=>browser.delete(k)});
  const requests:{name?:string;entry_key?:string}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    if(url.endsWith('/logout'))return Response.json({ok:true});
    requests.push(JSON.parse(String(init.body)));
    return Response.json({token:'test-session',role:'doctor',cohort:'junior',display_name:'Dr Lee'});
  }));
  const {enterReader}=await import('./session');
  await enterReader('junior','Dr Lee');
  saved.clear();
  await enterReader('junior','Dr Lee');
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0]).not.toHaveProperty('returning');
  expect(browser.size).toBe(1);
  saved.clear();
  await expect(enterReader('junior','Dr Le')).resolves.toMatchObject({display_name:'Dr Lee',cohort:'junior'});
  expect(requests[2]).toEqual({...requests[0],name:'Dr Le'});
});

it('clears the signed-out reader’s browser key so a first-time reader can use the shared computer',async()=>{
  location.hash='#/senior/workspace';
  const browser=new Map<string,string>([['ct-crossover-device:junior','junior-device']]);
  vi.stubGlobal('localStorage',{getItem:(k:string)=>browser.get(k)??null,setItem:(k:string,v:string)=>browser.set(k,v),removeItem:(k:string)=>browser.delete(k)});
  saved.set('ct-review-session','admin-token');
  saved.set('ct-crossover-session:junior','junior-token');
  const requests:{name:string;entry_key:string}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
    if(url.endsWith('/logout'))return Response.json({ok:true});
    const input=JSON.parse(String(init.body));requests.push(input);
    return Response.json({token:'senior-'+requests.length,role:'doctor',cohort:'senior',display_name:input.name});
  }));
  const {enterReader,logout,sessionToken}=await import('./session');
  await enterReader('senior','First Reader');
  await enterReader('senior','Second Reader');
  expect(requests[1].entry_key).toBe(requests[0].entry_key);
  expect(sessionToken()).toBe('senior-2');
  await logout();
  expect(sessionToken()).toBe('');
  expect(saved.has('ct-crossover-device:senior')).toBe(false);
  expect(browser.has('ct-crossover-device:senior')).toBe(false);
  expect(browser.get('ct-crossover-device:junior')).toBe('junior-device');
  expect(saved.get('ct-crossover-session:junior')).toBe('junior-token');
  expect(saved.get('ct-review-session')).toBe('admin-token');
  await enterReader('senior','New Reader');
  expect(requests[2].entry_key).not.toBe(requests[0].entry_key);
});

it('exports the entered name and the individual reviewer identifier and keeps spreadsheet formulas inert',()=>{
  const row:StudyResult={case_id:'Case01',username:'guest-one',display_name:'=test',letter:'A',model_name:'method',rating:4,comment:'',updated_at:null};
  const csv=exportBlindResults([row]);
  expect(csv).toContain('"username","display_name"');
  expect(csv).toContain('"guest-one","\'=test"');
});
