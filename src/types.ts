export interface ModelReport { id:string; model_name:string; report_name:string; report_text:string }
export interface ImagingAsset { type:'NIFTI'|'DICOM'; filename:string; asset_name:string; size:number; sha256?:string }
export interface Case { schema_version:'1.0'; case_id:string; case_name:string; description:string; created_at:string; imaging:ImagingAsset; reports:ModelReport[] }
export interface ReleaseAsset {id:number; name:string; size:number; url:string; browser_download_url:string; state:string; sha256?:string}
export interface CaseRelease extends Case { release_id:number; release_url:string; tag:string; asset:ReleaseAsset; source?:'google-drive'; report_url?:string }
export const ratings = ['1','2','3','4','5'] as const;
export type Rating = typeof ratings[number];
// Legacy decisions remain readable without inventing numeric scores.
export type Decision = Rating|'ACCEPT'|'REJECT'|'PARTIAL_ACCEPT';
export interface Review {schema:'ct-review-v1';case_id:string;report_id:string;model_name:string;decision:Decision;comment:string;submission_id:string;release_id:number}
export interface GitHubReview extends Review {reviewer:string;created_at:string;github_issue_number:number;url:string}
export interface LocalReview {decision?:Decision; comment:string; submission_id:string; status:'Local'|'Pending GitHub Submission'|'Submitted'}
export const decisionLabels:Record<Decision,string>={'1':'1 · Poor','2':'2','3':'3','4':'4','5':'5 · Excellent',ACCEPT:'Legacy: Accept',REJECT:'Legacy: Reject',PARTIAL_ACCEPT:'Legacy: Partially Accept'};
