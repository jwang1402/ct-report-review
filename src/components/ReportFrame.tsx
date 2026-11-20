import {useState,type ReactNode} from 'react';
import {FileText,Download} from 'lucide-react';
import {saveFile} from '../utils';
import {isStudyACase} from '../services/studyDisplay';
import {Tabs,TabsContent,TabsList,TabsTrigger} from './Tabs';
import {Expandable} from './Expandable';

interface TabReport {id:string; label:string; text:string;}
export function ReportFrame({caseId,items,selected,select,summary,children,control}:{caseId:string;items:TabReport[];selected:string;select:(value:string)=>void;summary?:string;children:ReactNode;control?:ReactNode}) {
  const [hidden,setHidden]=useState(false);
  const [font,setFont]=useState(14);
  const fileCase=isStudyACase(caseId)?caseId.replace(/^br4shared-/i,'Study-A-'):caseId;
  return <Expandable title="Model reports"><aside className={'report-panel'+(hidden?' reviews-hidden':'')}>
    <div className="panel-header"><div><FileText size={16}/><h2>Model reports</h2>
      <button className="icon-button" aria-label="Decrease report text" onClick={()=>setFont(s=>Math.max(10,s-2))}>A−</button>
      <button className="icon-button" aria-label="Increase report text" onClick={()=>setFont(s=>Math.min(32,s+2))}>A+</button></div><span>{summary}</span></div>
    {control}
    <Tabs value={selected} onValueChange={select} className="report-tabs"><TabsList aria-label="Model reports">{items.map(r=>
      <TabsTrigger key={r.id} value={r.id}>{r.label}</TabsTrigger>)}</TabsList>
      {items.map(r=><TabsContent key={r.id} value={r.id} className="report-content">
        <span className="eyebrow">AI-GENERATED REPORT</span><div className="report-title"><h3>{r.label}</h3>
          <button className="icon-button" disabled={!r.text} title="Download Report" aria-label={'Download '+r.label} onClick={()=>saveFile(r.text,fileCase+'-'+r.id+'.txt')}><Download size={16}/></button></div>
        <div className="report-text" style={{fontSize:font}}>{r.text||'This report is unavailable. Please contact the study coordinator.'}</div>
      </TabsContent>)}</Tabs>
    <button className="review-collapse" aria-expanded={!hidden} aria-controls="review-body" onClick={()=>setHidden(v=>!v)}>{hidden?'▲ Show reviews':'▼ Hide reviews'}</button>
    <div id="review-body" className="review-body" hidden={hidden}>{children}</div>
  </aside></Expandable>;
}
