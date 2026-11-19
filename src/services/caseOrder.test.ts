import {expect,it} from 'vitest';
import {inCaseOrder} from './caseOrder';

it('orders numbered cases consistently without changing the source assignment order',()=>{
  const cases=['Open-Case10','Open-Case2','Open-Case01'].map(case_id=>({case_id}));
  expect(inCaseOrder(cases).map(c=>c.case_id)).toEqual(['Open-Case01','Open-Case2','Open-Case10']);
  expect(cases[0].case_id).toBe('Open-Case10');
});
