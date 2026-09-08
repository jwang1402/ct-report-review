import {api} from './session';
import type {GitHubReview,Review} from '../types';
export async function listReviews(_refresh=false){const reviews:GitHubReview[]=[];let after=0;do{const page=await api('/reviews?after='+after);reviews.push(...page.reviews);if(page.next===null)break;if(!Number.isSafeInteger(page.next)||page.next<=after)throw new Error('Invalid review pagination');after=page.next;}while(true);return {reviews,warnings:[] as string[]};}
export async function submitReview(review:Review&{reviewer:string}){return (await api('/reviews',{method:'POST',body:JSON.stringify(review)})).review as GitHubReview;}
export async function updateReview(review:Review&{reviewer:string},previous:GitHubReview){return (await api('/reviews/'+encodeURIComponent(review.submission_id)+'/update',{method:'POST',body:JSON.stringify({...review,previous:{reviewer:previous.reviewer,decision:previous.decision,comment:previous.comment}})})).review as GitHubReview;}
export async function submitCaseReviews(reviews:(Review&{reviewer:string})[]){return (await api('/reviews/batch',{method:'POST',body:JSON.stringify({reviews})})).reviews as GitHubReview[];}

export async function deleteReview(review:GitHubReview){await api('/reviews/'+encodeURIComponent(review.submission_id)+'/delete',{method:'POST',body:JSON.stringify({previous:{reviewer:review.reviewer,decision:review.decision,comment:review.comment}})});}
