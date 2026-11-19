export const hasHan = value => typeof value==='string' && /\p{Script=Han}/u.test(value);

export function displayCaseName(name,id) {
  return hasHan(name)?id:name;
}

export function displayReaderName(name,id) {
  return hasHan(name)?'Reader '+id.slice(-8):name;
}

export function displayComment(comment) {
  return hasHan(comment)?'Saved comment cannot be displayed.':comment;
}
