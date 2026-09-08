export interface ModelReport { id:string; model_name:string; report_name:string; report_text:string }
export interface ImagingAsset { type:'NIFTI'|'DICOM'; filename:string; asset_name:string; size:number; sha256?:string }
export interface Case { schema_version:'1.0'; case_id:string; case_name:string; description:string; created_at:string; imaging:ImagingAsset; reports:ModelReport[] }
export interface ReleaseAsset {id:number; name:string; size:number; url:string; browser_download_url:string; state:string}
export interface CaseRelease extends Case { release_id:number; release_url:string; tag:string; asset:ReleaseAsset }
export type Decision = 'ACCEPT'|'REJECT'|'PARTIAL_ACCEPT';
export interface Review {schema:'ct-review-v1';case_id:string;report_id:string;model_name:string;decision:Decision;comment:string;submission_id:string;release_id:number}
export interface GitHubReview extends Review {reviewer:string;created_at:string;github_issue_number:number;url:string}
export interface LocalReview {decision?:Decision; comment:string; submission_id:string; status:'Local'|'Pending GitHub Submission'|'Submitted'}
export const decisionLabels:Record<Decision,string>={ACCEPT:'Accept',REJECT:'Reject',PARTIAL_ACCEPT:'Partially Accept'};
