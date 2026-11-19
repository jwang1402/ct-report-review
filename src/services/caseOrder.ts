const collator = new Intl.Collator('en', {numeric:true});

export function compareCaseIds(a:string, b:string) {
  return collator.compare(a,b) || (a<b ? -1 : a>b ? 1 : 0);
}

export function inCaseOrder<T extends {case_id:string}>(cases:readonly T[]) {
  return [...cases].sort((a,b)=>compareCaseIds(a.case_id,b.case_id));
}
