import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ReviewDecision} from './ReviewDecision';
import type {CaseRelease} from '../types';
it('renders five findings ratings with no default and optional feedback',()=>{
 const report={id:'a',model_name:'morph',report_name:'Findings',report_text:'Test report'};
 const item={release_id:1,reports:[report]} as CaseRelease;
 const html=renderToStaticMarkup(<ReviewDecision item={item} report={report} reviews={[]} refresh={async()=>{}}/>);
 expect(html.match(/type="radio"/g)).toHaveLength(5);
 for(const value of ['1','2','3','4','5'])expect(html).toContain(`value="${value}"`);
 expect(html).toContain('1 · Poor');
 expect(html).toContain('5 · Excellent');
 expect(html).toContain('model');
 expect(html).not.toContain('morph');
 expect(html).toContain('Comment optional');
 expect(html).not.toContain('checked=""');
 expect(html).not.toContain('Accept');
 expect(html).toContain('disabled="">Submit all reports');
});
