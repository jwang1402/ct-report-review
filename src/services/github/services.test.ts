import {describe,it,expect} from 'vitest';
import {parseCase,mirrorUrl} from './releases';
import {parseReviewIssue,buildReviewIssueUrl,reviewsCSV} from './issues';
import {guardSize} from './releaseAssets';
import type {Review} from '../../types';
const review:Review={schema:'ct-review-v1',case_id:'CT001',report_id:'model-a',model_name:'Example model',decision:'PARTIAL_ACCEPT',comment:'Location is right.\nSize needs review.',submission_id:'unique-submission',release_id:42};
describe('GitHub review interchange',()=>{
 it('round trips a prefilled review using the actual issue author',()=>{const {url,body}=buildReviewIssueUrl(review);const u=new URL(url);expect(u.searchParams.get('body')).toBe(body);const result=parseReviewIssue({number:5,title:u.searchParams.get('title')!,body,user:{login:'real-reviewer'},created_at:'2026-09-08',html_url:'https://github.com/issue/5'});expect(result).toMatchObject({...review,reviewer:'real-reviewer',github_issue_number:5});});
 it('requires feedback for partial acceptance',()=>expect(()=>buildReviewIssueUrl({...review,comment:'  '})).toThrow());
 it('ignores pull requests and unrelated issues',()=>{expect(parseReviewIssue({number:1,title:'hello',body:'',user:null,created_at:'',html_url:''})).toBeNull();expect(parseReviewIssue({number:1,title:'[CT-REVIEW]',body:'',user:null,created_at:'',html_url:'',pull_request:{}})).toBeNull();});
 it('rejects invalid review schema and decision',()=>{expect(()=>parseReviewIssue({number:1,title:'[CT-REVIEW]',body:'```json\n{"schema":"ct-review-v1","decision":"MAYBE"}\n```',user:{login:'a'},created_at:'',html_url:''})).toThrow();});
 it('escapes multiline CSV and neutralizes spreadsheet formulas',()=>{const row={...review,comment:'=HYPERLINK("bad")\nsecond line',reviewer:'someone',github_issue_number:1,created_at:'date',url:'url'};const csv=reviewsCSV([row],new Map([['42','CT test']]));expect(csv).toContain('"\'=HYPERLINK(""bad"")\nsecond line"');expect(csv).toContain('"CT test"');});
});
describe('case and asset validation',()=>{
 it('keeps imaging on the Pages origin and within the repository subpath',()=>{const base=new URL('https://jwang1402.github.io/ct-report-review/');expect(mirrorUrl('data/cases/42/abc123/imaging.nii.gz.bin',base)).toBe('https://jwang1402.github.io/ct-report-review/data/cases/42/abc123/imaging.nii.gz.bin');for(const p of ['https://evil.test/ct.nii','//evil.test/ct.nii','data/cases/../imaging.nii','data/cases/42/%2e%2e/imaging.nii'])expect(()=>mirrorUrl(p,base)).toThrow();});
 it('blocks empty and >= 2 GiB assets',()=>{expect(()=>guardSize(0)).toThrow();expect(()=>guardSize(2*1024**3)).toThrow();expect(()=>guardSize(2*1024**3-1)).not.toThrow();});
 it('rejects duplicate model report IDs',()=>{const c={schema_version:'1.0',case_id:'CT001',case_name:'Study',description:'',created_at:'2026-09-08',imaging:{type:'NIFTI',filename:'CT001.nii',asset_name:'CT001.nii',size:500},reports:[{id:'a',model_name:'A',report_name:'R',report_text:'Text'}]};expect(parseCase(c).case_id).toBe('CT001');expect(()=>parseCase({...c,reports:[...c.reports,...c.reports]})).toThrow();});
});
