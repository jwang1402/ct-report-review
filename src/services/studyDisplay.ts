const studyACase=/^br4shared-(Case(?:0[1-9]|10))$/i;

export const isStudyACase=(caseId:string)=>studyACase.test(caseId);
export const studyDisplayName=(prefix:string)=>prefix.toLowerCase()==='br4shared'?'Study A':prefix;
export function caseDisplayLabel(caseId:string) {
  const match=caseId.match(studyACase);
  return match?'Study A · '+match[1]:caseId;
}
