import { githubConfig } from '../../config';
const base=`https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}`;
export let rateLimitRemaining: string|null=null;
export async function githubRequest<T>(path:string):Promise<T>{
 let response:Response;
 try {response=await fetch(`${base}${path}`,{headers:{Accept:'application/vnd.github+json'}})} catch {throw new Error('Cannot connect to GitHub. Check your network and try again.');}
 rateLimitRemaining=response.headers.get('x-ratelimit-remaining');
 if(!response.ok){
  if(response.status===403||response.status===429) throw new Error(rateLimitRemaining==='0'?'GitHub API rate limit reached. Try again after '+new Date(Number(response.headers.get('x-ratelimit-reset'))*1000).toLocaleTimeString()+'.':'GitHub denied access. Check that the repository is public.');
  if(response.status===404) throw new Error('GitHub repository or resource not found. Check repository settings.');
  throw new Error(`GitHub request failed (${response.status}). Try again.`);
 }
 return response.json() as Promise<T>;
}
export async function allPages<T>(path:string):Promise<T[]>{const result:T[]=[];for(let page=1;;page++){const rows=await githubRequest<T[]>(`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);result.push(...rows);if(rows.length<100)return result;}}
