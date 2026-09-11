import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReviewDecision} from './ReviewDecision';
import type {CaseRelease,GitHubReview} from '../types';
it('renders five findings ratings with no default and optional feedback',()=>{
 const report={id:'a',model_name:'morph',report_name:'Findings',report_text:'Test report'};
 const item={release_id:1,reports:[report]} as CaseRelease;
 const html=renderToStaticMarkup(<ReviewDecision item={item} report={report} reviews={[]} refresh={async()=>{}}/>);
 expect(html.match(/type="radio"/g)).toHaveLength(5);
 for(const value of ['1','2','3','4','5'])expect(html).toContain(`value="${value}"`);
 expect(html).toContain('1 · Poor');
 expect(html).toContain('5 · Excellent');
 expect(html).toContain('model · Review');
 expect(html).not.toContain('morph');
 expect(html).toContain('Comment optional');
 expect(html).not.toContain('checked=""');
 expect(html).not.toContain('Accept');
 expect(html).toContain('disabled="">Submit all reports');
});

it('keeps submitted review labels distinct by report id',()=>{
 const reports=[
  {id:'1',model_name:'morph',report_name:'Findings',report_text:'First report'},
  {id:'2',model_name:'morph',report_name:'Findings',report_text:'Second report'},
 ];
 const item={release_id:1,reports} as CaseRelease;
 const base={schema:'ct-review-v1',case_id:'case-1',release_id:1,model_name:'morph',decision:'4',reviewer:'Dr Test',comment:'',created_at:'2026-09-11T00:00:00Z',github_issue_number:1,url:'https://example.com'};
 const reviews=[
  {...base,report_id:'1',submission_id:'submission-report-1'},
  {...base,report_id:'2',submission_id:'submission-report-2'},
 ] as GitHubReview[];
 const html=renderToStaticMarkup(<ReviewDecision item={item} report={reports[0]} reviews={reviews} refresh={async()=>{}}/>);
 expect(html).toContain('model · 1 · Review');
 expect(html).toContain('model · 2 · Review');
});
