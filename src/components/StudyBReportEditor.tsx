import {ChevronDown, LockKeyhole} from 'lucide-react';
import type {Reading} from '../services/studyB';
import './StudyBReportEditor.css';

interface Props {
  entry: Pick<Reading, 'condition' | 'draft'>;
  report: string;
  onChange: (value: string) => void;
}

export default function StudyBReportEditor({entry, report, onChange}: Props) {
  const assisted = entry.condition === 'with_ai';
  return <>
    {assisted && <details open className="sb-original-draft">
      <summary>
        <span>MORPH-CT draft</span>
        <small><LockKeyhole size={12} aria-hidden="true"/> Read-only</small>
        <ChevronDown className="sb-draft-chevron" size={16} aria-hidden="true"/>
      </summary>
      <div role="region" aria-label="Original MORPH-CT draft" tabIndex={0} className="sb-original-text">
        {entry.draft || 'Original draft unavailable.'}
      </div>
    </details>}
    <label className="sb-final-report-label" htmlFor="sb-report">Final report</label>
    <p className="sb-hint" id="sb-report-help">{assisted ? 'Write your findings and impression. You can copy text from the draft above.' : 'Write your findings and impression.'}</p>
    <textarea id="sb-report" aria-describedby="sb-report-help" className="sb-report" rows={10} maxLength={48000}
      value={report} onChange={e=>onChange(e.currentTarget.value)}/>
  </>;
}
