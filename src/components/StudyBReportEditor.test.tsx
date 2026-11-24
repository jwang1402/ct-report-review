import {renderToStaticMarkup} from 'react-dom/server';
import {expect, it} from 'vitest';
import type {Condition} from '../services/studyB';
import StudyBReportEditor from './StudyBReportEditor';

function render(condition: Condition) {
  return renderToStaticMarkup(<StudyBReportEditor entry={{condition, draft: 'Original draft text.'}}
    report="Saved text edited by the reader." onChange={()=>{}}/>);
}

it('shows the frozen source separately from the saved assisted report', () => {
  const html = render('with_ai');
  expect(html).toMatch(/aria-label="Original MORPH-CT draft"[^>]*>Original draft text\.<\/div>/);
  expect(html).toMatch(/<textarea[^>]*>Saved text edited by the reader\.<\/textarea>/);
  expect(html.match(/<textarea\b/g)).toHaveLength(1);
});

it('never renders the source in an unaided reading, even if provided extraneously', () => {
  const html = render('without_ai');
  expect(html).not.toContain('MORPH-CT draft');
  expect(html).not.toContain('Original draft text.');
  expect(html).toContain('Saved text edited by the reader.');
});
