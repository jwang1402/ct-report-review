export const findingNames={
  cardiomegaly:'Cardiomegaly', hiatal_hernia:'Hiatal hernia', pericardial_effusion:'Pericardial effusion',
  lymphadenopathy:'Lymphadenopathy', lung_nodule:'Lung nodule', emphysema:'Emphysema',
  interlobular_septal_thickening:'Interlobular septal thickening', consolidation:'Consolidation',
  atelectasis:'Atelectasis', lung_opacity:'Lung opacity', pulmonary_fibrotic_sequela:'Pulmonary fibrotic sequela',
  bronchiectasis:'Bronchiectasis', pleural_effusion:'Pleural effusion', mosaic_attenuation_pattern:'Mosaic attenuation pattern',
  arterial_wall_calcification:'Arterial wall calcification', peribronchial_thickening:'Peribronchial thickening',
  medical_material:'Medical material', coronary_artery_wall_calcification:'Coronary artery wall calcification',
} as const;
export type Finding=keyof typeof findingNames;
export const findings=Object.keys(findingNames) as Finding[];
export const errorNames={missed:'Missed finding',unsupported:'Unsupported finding',location:'Incorrect location / laterality',other:'Other description error'} as const;
export type ErrorType=keyof typeof errorNames;
export interface FindingError { finding:Finding|'other'; other:string; type:ErrorType; significant:boolean; detail:string }
export interface ReviewDraft {mode:'yes'|'no'|null; errors:FindingError[]; rating:number|null; comment:string; confirmed:boolean}
export interface SavedReview extends ReviewDraft { version:number; updated_at:string; confirmed:true; mode:'yes'|'no'; rating:number }
export type FindingMap=Record<Finding,0|1>;
export interface StudyAReport {letter:'A'|'B'|'C';text:string;findings:FindingMap|null;review:SavedReview|null}
export const blankReview=():ReviewDraft=>({mode:null,errors:[],rating:null,comment:'',confirmed:false});
export const validFindings=(map:FindingMap|null)=>!!map&&findings.every(f=>map[f]===0||map[f]===1);
export function reviewProblem(d:ReviewDraft):string {
  if(!d.mode)return 'Indicate whether you identified any errors.';
  if(d.mode==='yes'&&!d.errors.length)return 'Record at least one error or select No errors identified.';
  if(!d.rating)return 'Choose an overall report quality score.';
  if(!d.confirmed)return 'Confirm that you have reviewed all findings.';
  return '';
}
