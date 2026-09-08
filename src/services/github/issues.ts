import {repositoryUrl} from '../../config';
import {allPages} from './githubClient';
import type {GitHubReview,Review,Decision} from '../../types';
interface Issue {number:number;title:string;body:string|null;user:{login:string}|null;created_at:string;html_url:string;pull_request?:unknown}
let cache:{reviews:GitHubReview[];warnings:string[]}|undefined;
export function parseReviewIssue(issue:Issue):GitHubReview|null{
 if(issue.pull_request||!issue.title.startsWith('[CT-REVIEW]'))return null;
 const block=issue.body?.match(/```json\s*\n([\s\S]*?)\n```/);if(!block)throw new Error('Missing review JSON');
 const r=JSON.parse(block[1]) as Review;
 if(r.schema!=='ct-review-v1'||!['ACCEPT','REJECT','PARTIAL_ACCEPT'].includes(r.decision)||![r.case_id,r.report_id,r.model_name,r.comment].every(x=>typeof x==='string')||!r.case_id||!r.report_id||(r.decision==='PARTIAL_ACCEPT'&&!r.comment.trim())||!issue.user?.login)throw new Error('Invalid review fields');
 return {...r,submission_id:typeof r.submission_id==='string'?r.submission_id:'',release_id:Number.isSafeInteger(r.release_id)?r.release_id:0,reviewer:issue.user.login,created_at:issue.created_at,github_issue_number:issue.number,url:issue.html_url};
}
export async function listReviews(refresh=false){if(cache&&!refresh)return cache;const issues=await allPages<Issue>('/issues?state=all');const reviews:GitHubReview[]=[];const warnings:string[]=[];for(const issue of issues){try{const r=parseReviewIssue(issue);if(r)reviews.push(r);}catch{warnings.push(`Issue #${issue.number}: review JSON could not be parsed.`);}}cache={reviews,warnings};return cache;}
export function buildReviewIssueUrl(r:Review){
 if(r.decision==='PARTIAL_ACCEPT'&&!r.comment.trim())throw new Error('A comment is required for partial acceptance.');
 const body=`CT Report Review\n\nCase: ${r.case_id}\nModel: ${r.model_name}\nDecision: ${r.decision}\n\nComment:\n${r.comment||'—'}\n\n\`\`\`json\n${JSON.stringify(r,null,2)}\n\`\`\`\n`;
 const url=new URL(`${repositoryUrl}/issues/new`);url.searchParams.set('title',`[CT-REVIEW] ${r.case_id} | ${r.report_id} | ${r.decision}`);url.searchParams.set('body',body);return {url:url.toString(),body};
}
export function reviewsCSV(reviews:GitHubReview[],names:Map<string,string>){const fields=['case_id','case_name','report_id','model_name','reviewer','decision','comment','created_at','github_issue_number'];const quote=(v:unknown)=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\ufeff'+[fields.map(quote).join(','),...reviews.map(r=>{const row:Record<string,unknown>={...r,case_name:names.get(String(r.release_id))||names.get(r.case_id)||''};return fields.map(f=>quote(row[f])).join(',');})].join('\r\n');}
export function counts(reviews:GitHubReview[]){const c:Record<Decision,number>={ACCEPT:0,REJECT:0,PARTIAL_ACCEPT:0};reviews.forEach(r=>c[r.decision]++);return c;}
