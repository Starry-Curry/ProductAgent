import {createHash} from 'node:crypto';
import {fetchPublicDocument,resolvePublicPublisherHomepage,sourceURL} from './sources.ts';

/** Publisher identity is independent of product facts. Public DBpedia company
 * records are fallible discovery evidence, not a certification of any claim.
 * The model cannot manufacture this proof: it is collected by the server and
 * stored only with an exact-model document after scope checks. */
export type PublisherProof={
 version:1|2;brand:string;directoryURL:string;entity:string;record:string;recordHash:string;
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
const directoryHost=(host:string)=>/^(?:[a-z]{2,3}\.)?dbpedia\.org$/.test(host);
/** Old public records often list HTTP. Never fetch HTTP: require TLS at the
 * SAME hostname, then follow the existing bounded public redirect verifier. */
function secureHomepage(value:string){const u=new URL(value);if(u.protocol==='http:')u.protocol='https:';return sourceURL(u.href).href;}
function wikidataFields(record:string,id:string){try{return JSON.parse(record).entities?.[id];}catch{return;}}
function wikidataMatches(e:any,brand:string){const names=[...Object.values(e.labels||{}),...Object.values(e.aliases||{}).flat()] as {value:string}[];const b=norm(brand);return names.some(x=>norm(x.value)===b||norm(x.value).startsWith(b+' '));}
function wikidataSites(e:any){return (e.claims?.P856||[]).filter((c:any)=>c.rank!=='deprecated'&&c.mainsnak?.snaktype==='value'&&typeof c.mainsnak.datavalue?.value==='string').map((c:any)=>c.mainsnak.datavalue.value as string);}
function wikidataCompany(e:any){return (e.claims?.P31||[]).some((c:any)=>c.rank!=='deprecated'&&['Q4830453','Q43229','Q783794','Q6881511','Q891723'].includes(c.mainsnak?.datavalue?.value?.id));}
export function publisherOwns(url:string,brand:string,p?:PublisherProof){
 try{
  if(!p||![1,2].includes(p.version)||norm(p.brand)!==norm(brand)||hash(p.record)!==p.recordHash)return false;
  const directory=sourceURL(p.directoryURL);
  if(p.version===1){
   const entity=new URL(p.entity);
   if(!directoryHost(directory.hostname)||directory.hostname!==entity.hostname||entity.username||entity.password||!entity.pathname.startsWith('/resource/')||directory.pathname!=='/data/'+entity.pathname.slice('/resource/'.length)+'.json')return false;
   const r=subject(p.record,p.entity);if(!r||!company(r)||!matches(r,brand)||!homepages(r).includes(p.homepage))return false;
  }else{
   if(!/^Q[1-9]\d*$/.test(p.entity)||directory.hostname!=='www.wikidata.org'||directory.pathname!=='/wiki/Special:EntityData/'+p.entity+'.json'||directory.search||directory.hash)return false;
   const e=wikidataFields(p.record,p.entity);if(!e||e.id!==p.entity||!wikidataCompany(e)||!wikidataMatches(e,brand)||!wikidataSites(e).includes(p.homepage))return false;
  }
  if(!p.redirectChain.length||p.redirectChain.length>3||p.redirectChain[0]!==secureHomepage(p.homepage))return false;
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
 const wikidataIds=new Set<string>();
 try{
  const lookupURL='https://lookup.dbpedia.org/api/search?query='+encodeURIComponent(brand)+'&format=JSON&maxResults=40';
  const lookup=JSON.parse((await fetcher(lookupURL)).text);
  const candidates=(Array.isArray(lookup.docs)?lookup.docs:[]).filter((d:any)=>d.label?.some((l:string)=>{const n=norm(l),b=norm(brand);return n===b||n.startsWith(b+' ');})).slice(0,8);
  const records=await Promise.allSettled(candidates.map(async(d:any)=>{
   const entity=String(d.resource?.[0]||''),u=new URL(entity);if(!directoryHost(u.hostname)||!u.pathname.startsWith('/resource/'))return;
   const directoryURL='https://'+u.hostname+'/data/'+u.pathname.slice('/resource/'.length)+'.json';
   const page=await fetcher(directoryURL),r=subject(page.text,entity);if(!r||!company(r)||!matches(r,brand))return;
   for(const link of r['http://www.w3.org/2002/07/owl#sameAs']||[]){const match=link.value.match(/^https?:\/\/www\.wikidata\.org\/entity\/(Q[1-9]\d*)$/);if(match)wikidataIds.add(match[1]);}
   for(const homepage of homepages(r).slice(0,1)){
    // Following the independently listed publisher's TLS redirect is required
    // even if its old hostname happens to resemble a search hit.
    try{const migration=await resolve(secureHomepage(homepage));const proof:PublisherProof={version:1,brand,directoryURL,entity,record:JSON.stringify({[entity]:r}),recordHash:'',homepage,redirectChain:migration.chain,verifiedAt:new Date().toISOString()};proof.recordHash=hash(proof.record);
     return proof;
    }catch{}
   }
  }));
  for(const result of records)if(result.status==='fulfilled'&&result.value)proofs.push(result.value);
  // Independent structured official-website properties can recover stale
  // directory homepages. No model-selected URL or per-brand allowlist grants.
  if(!proofs.length)for(const id of [...wikidataIds].slice(0,2)){
   try{
    const directoryURL='https://www.wikidata.org/wiki/Special:EntityData/'+id+'.json';
    const page=await fetcher(directoryURL),e=wikidataFields(page.text,id);if(!e||e.id!==id||!wikidataCompany(e)||!wikidataMatches(e,brand))continue;
    for(const homepage of wikidataSites(e).slice(0,4)){
     try{const migration=await resolve(secureHomepage(homepage));
      const proof:PublisherProof={version:2,brand,directoryURL,entity:id,record:JSON.stringify({entities:{[id]:{id:e.id,labels:e.labels,aliases:e.aliases,claims:{P31:e.claims.P31,P856:e.claims.P856}}}}),recordHash:'',homepage,redirectChain:migration.chain,verifiedAt:new Date().toISOString()};proof.recordHash=hash(proof.record);
      proofs.push(proof);
     }catch{}
    }
   }catch{}
  }
  if(!proofs.length)issues.push('公开机构目录与候选站点之间没有可核对的厂家身份链；未认证为官方资料。');
 }catch{issues.push('公开厂家身份目录未取得；保留搜索候选，不把模型判断升级为官方认证。');}
 // A separately verified regional publisher may not be in the first search
 // results. Keep that identity for a bounded site search; it grants NO trust
 // to any of the original, unmatched candidate URLs.
 proofs.sort((a,b)=>Number(candidateURLs.some(url=>publisherOwns(url,brand,b)))-Number(candidateURLs.some(url=>publisherOwns(url,brand,a))));
 return {proofs,issues};
}
