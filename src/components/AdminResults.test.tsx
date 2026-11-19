import {expect,it} from 'vitest';
import {summarizeReaders} from './AdminResults';
import type {Letter,StudyResult} from '../services/blindStudy';

it('counts completed cases per reader across four letters and keeps namesakes separate',()=>{
  const results:StudyResult[]=[];
  for(const username of ['reader:one','reader:two']){
    for(const case_id of ['Study-Case01','Study-Case02']){
      for(const letter of ['A','B','C','D'] as Letter[]){
        const complete=username==='reader:one'&&case_id==='Study-Case01';
        const partial=username==='reader:two'&&case_id==='Study-Case01'&&letter==='A';
        results.push({case_id,username,display_name:'Chen',letter,model_name:'m'+letter,
          rating:complete?4:partial?2:null,comment:'',updated_at:null});
      }
    }
  }
  const [one,two]=summarizeReaders(results);
  expect(one.name).not.toBe(two.name);
  expect([one.completed,one.assigned,one.mean]).toEqual([1,2,'4.00']);
  expect([two.completed,two.assigned,two.mean]).toEqual([0,2,'2.00']);
});

it('includes readers who have no assigned cases in the administrator list',()=>{
  const readers=summarizeReaders([], [{username:'doctor',display_name:null,version:'example-version'}]);
  expect(readers).toEqual([{id:'doctor',name:'doctor',assigned:0,completed:0,mean:'—'}]);
});
