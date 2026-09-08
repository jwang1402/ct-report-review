import {api} from './session';
import type {GitHubReview,Review} from '../types';
export async function listReviews(_refresh=false){const reviews:GitHubReview[]=[];let after=0;do{const page=await api('/reviews?after='+after);reviews.push(...page.reviews);if(page.next===null)break;if(!Number.isSafeInteger(page.next)||page.next<=after)throw new Error('Invalid review pagination');after=page.next;}while(true);return {reviews,warnings:[] as string[]};}
export async function submitReview(review:Review&{reviewer:string}){return (await api('/reviews',{method:'POST',body:JSON.stringify(review)})).review as GitHubReview;}
