declare module '*english-ui.mjs' {
  export function hasHan(value:unknown):boolean;
  export function displayCaseName(name:string,id:string):string;
  export function displayReaderName<T extends string|null|undefined>(name:T,id:string):T|string;
  export function displayComment(comment:string):string;
}
