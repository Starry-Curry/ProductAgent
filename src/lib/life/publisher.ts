import {createHash} from 'node:crypto';
import {fetchPublicDocument,resolvePublicPublisherHomepage,sourceURL} from './sources.ts';

/** Publisher identity is independent of product facts. Public DBpedia company
 * records are fallible discovery evidence, not a certification of any claim.
 * The model cannot manufacture this proof: it is collected by the server and
 * stored only with an exact-model document after scope checks. */
export type PublisherProof={
 version:1;brand:string;directoryURL:string;entity:string;record:string;recordHash:string;
 homepage:string;redirectChain:string[];verifiedAt:string;
};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const norm=(s:string)=>s.normalize('NFKC').toLocaleLowerCase().replace(/<[^>]*>/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
type Field={value:string;type?:string;lang?:string};
type RecordFields=Record<string,Field[]>;
function subject(record:string,entity:string){try{return JSON.parse(record)[entity] as RecordFields|undefined;}catch{return;}}
function company(r:RecordFields){return (r['http://www.w3.org/1999/02/22-rdf-syntax-ns#type']||[]).some(x=>/\/(?:Company|Organisation|Organization)$/.test(x.value));}
function matches(r:RecordFields,brand:string){const b=norm(brand);return !!b&&(r['http://www.w3.org/2000/01/rdf-schema#label']||[]).some(x=>{const n=norm(x.value);return n===b||n.startsWith(b+' ');});}
function homepages(r:RecordFields){return (r['http://xmlns.com/foaf/0.1/homepage']||r['http://dbpedia.org/property/homepage']||[]).filter(x=>x.type==='uri').map(x=>x.value);}
export function publisherOwns(url:string,brand:string,p?:PublisherProof){
 try{
  if(!p||p.version!==1||norm(p.brand)!==norm(brand)||hash(p.record)!==p.recordHash)return false;
  const directory=sourceURL(p.directoryURL),entity=new URL(p.entity);
  if(directory.hostname!=='dbpedia.org'||!directory.pathname.startsWith('/data/')||entity.hostname!=='dbpedia.org'||!entity.pathname.startsWith('/resource/')||directory.pathname!=='/data/'+entity.pathname.slice('/resource/'.length)+'.json')return false;
  const r=subject(p.record,p.entity);if(!r||!company(r)||!matches(r,brand)||!homepages(r).includes(p.homepage))return false;
  if(!p.redirectChain.length||p.redirectChain.length>3||p.redirectChain[0]!==sourceURL(p.homepage).href)return false;
  for(const hop of p.redirectChain)sourceURL(hop);
  const root=sourceURL(p.redirectChain.at(-1)!).hostname.replace(/^www\./,'');
  const target=sourceURL(url);if(/(^|[.-])(community|communities|forum|forums|discussions)([.-]|$)/i.test(target.hostname)||/\/(?:community|forums|discussions|s\/question)(?:\/|$)/i.test(target.pathname))return false;
  return target.hostname===root||target.hostname.endsWith('.'+root);
 }catch{return false;}
}

/** Bounded generic company resolution. No per-brand domain additions, no guessed
 * manufacturer URLs, no personal question sent to the public directory. Only
 * candidates returned by native search can be matched to a verified homepage. */
export async function discoverPublishers(brand:string,candidateURLs:string[],deps:{fetchDocument?:typeof fetchPublicDocument;resolveHomepage?:typeof resolvePublicPublisherHomepage}={}){
 const fetcher=deps.fetchDocument||fetchPublicDocument,resolve=deps.resolveHomepage||resolvePublicPublisherHomepage;
 const proofs:PublisherProof[]=[],issues:string[]=[];
 try{
  const lookupURL='https://lookup.dbpedia.org/api/search?query='+encodeURIComponent(brand)+'&format=JSON&maxResults=40';
  const lookup=JSON.parse((await fetcher(lookupURL)).text);
  const candidates=(Array.isArray(lookup.docs)?lookup.docs:[]).filter((d:any)=>d.label?.some((l:string)=>{const n=norm(l),b=norm(brand);return n===b||n.startsWith(b+' ');})).slice(0,8);
  const records=await Promise.allSettled(candidates.map(async(d:any)=>{
   const entity=String(d.resource?.[0]||''),u=new URL(entity);if(u.hostname!=='dbpedia.org'||!u.pathname.startsWith('/resource/'))return;
   const directoryURL='https://dbpedia.org/data/'+u.pathname.slice('/resource/'.length)+'.json';
   const page=await fetcher(directoryURL),r=subject(page.text,entity);if(!r||!company(r)||!matches(r,brand))return;
   for(const homepage of homepages(r).slice(0,1)){
    // Following the independently listed publisher's TLS redirect is required
    // even if its old hostname happens to resemble a search hit.
    try{const migration=await resolve(homepage);const proof:PublisherProof={version:1,brand,directoryURL,entity,record:JSON.stringify({[entity]:r}),recordHash:'',homepage,redirectChain:migration.chain,verifiedAt:new Date().toISOString()};proof.recordHash=hash(proof.record);
     if(candidateURLs.some(url=>publisherOwns(url,brand,proof)))return proof;
    }catch{}
   }
  }));
  for(const result of records)if(result.status==='fulfilled'&&result.value)proofs.push(result.value);
  if(!proofs.length)issues.push('公开机构目录与候选站点之间没有可核对的厂家身份链；未认证为官方资料。');
 }catch{issues.push('公开厂家身份目录未取得；保留搜索候选，不把模型判断升级为官方认证。');}
 return {proofs,issues};
}
