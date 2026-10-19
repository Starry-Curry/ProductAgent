import { z } from "zod";
import { actor,localOnly,read,database,write } from "@/lib/db";
import { visible,mutate,canRead,type State } from "@/lib/domain";
import { AgentError } from "@/lib/agent/contracts";
import { listFragments,saveFragment,deleteFragment } from "@/lib/life/stories";
import { listSources,saveSource,parseCode,fetchPublicText } from "@/lib/life/sources";
import { discoverLife,listLifeIdeas,feedbackIdea,modelIdea } from "@/lib/life/ideas";
import { lifeProvider } from "@/lib/life/provider";
import { storePhoto } from "@/lib/life/media";
import { productPacks,searchProducts } from "@/lib/products";
import { installLifeDemo } from "@/lib/life/demo";
export const runtime="nodejs";
export const dynamic="force-dynamic";
function fail(e:unknown){return Response.json({error:e instanceof AgentError?e.message:e instanceof z.ZodError?"请检查填写内容、格式和长度":e instanceof Error?e.message:"操作未完成"},{status:e instanceof AgentError?e.status:400});}
export async function GET(r:Request){try{
  localOnly(r);const a=actor(r),db=database(),state=read(),p=new URL(r.url).searchParams;
  if(p.has("itemId"))return Response.json({sources:listSources(db,state,a,p.get("itemId")!),fragments:listFragments(db,state,a,p.get("itemId")!)});
  return Response.json({workspace:visible(state,a),fragments:listFragments(db,state,a),ideas:listLifeIdeas(db,state,a),packs:productPacks,capabilities:{visual:false,model:process.env.WUJIAN_ALLOW_PAID_CALLS==="true"&&process.env.AI_ALLOW_PAID_CALLS==="true",barcode:true,manual:true},stats:{items:state.items.filter(i=>canRead(i,a)&&!i.demo).length,syntheticItems:state.items.filter(i=>canRead(i,a)&&(i.synthetic||i.source==="示例数据")&&!i.demo).length,packs:productPacks.length,facts:productPacks.reduce((n,p)=>n+p.claims.length,0),procedures:2,fragments:listFragments(db,state,a).length}});
}catch(e){return fail(e);}}
export async function POST(r:Request){try{
  localOnly(r);const a=actor(r),db=database();
  if(r.headers.get("content-type")?.includes("multipart/form-data")){
    if(Number(r.headers.get("content-length")||0)>9_000_000)throw new AgentError("文件过大");
    const f=await r.formData(),file=f.get("file");
    if(!(file instanceof File)||file.size>8_000_000)throw new AgentError("需要小于 8MB 的文件");
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(f.get("kind")==="photo")return Response.json(await storePhoto(db,a,bytes));
    let text="";
    if(file.name.toLowerCase().endsWith(".pdf")){
      if(Buffer.from(bytes).subarray(0,5).toString()!=="%PDF-")throw new AgentError("PDF 文件内容无效");
      const {PDFParse}=await import("pdf-parse");
      const parser=new PDFParse({data:bytes});
      try{text=(await parser.getText({first:20})).text.slice(0,40000);}finally{await parser.destroy();}
    }else if(/\.(txt|md)$/i.test(file.name)){text=new TextDecoder().decode(bytes).slice(0,40000);}
    else throw new AgentError("说明书支持 PDF、TXT、Markdown；扫描 PDF 无 OCR 时可手动补充");
    if(text.trim().length<10)throw new AgentError("未提取到可用文字，请补充文字或人工确认；不代表完成 OCR");
    return Response.json({title:file.name.slice(0,150),text,kind:"user-manual",notice:"已在本机提取前 20 页内的文字，未核验型号或官方身份；原文件不持久保存。"});
  }
  const p=await r.json();
  if(p.action==="demo"){if(p.confirmed!==true)throw new AgentError("请确认载入合成案例");installLifeDemo(db);return Response.json({ok:true});}
  if(p.action==="code")return Response.json(parseCode(z.string().max(3000).parse(p.text)));
  if(p.action==="lookup")return Response.json({candidates:searchProducts(z.string().max(200).parse(p.query))});
  if(p.action==="fetchSource")return Response.json({...await fetchPublicText(z.string().max(2000).parse(p.url)),kind:"user-link",notice:"用户主动读取的公开正文；不会绕过登录，也不自动认证为官方资料。"});
  if(p.action==="createItem"){
    const v=z.object({name:z.string().trim().min(1).max(80),brand:z.string().max(80).default(""),model:z.string().max(100).default("待确认"),category:z.string().max(40),lifecycle:z.enum(["一次性","消耗型","可重复使用","长期耐用","持续养护"]),availability:z.enum(["unknown","available"]),attributes:z.record(z.string(),z.unknown()).optional(),mediaId:z.string().uuid().optional(),packId:z.string().optional(),confirmed:z.boolean().default(false)}).strict().parse(p.input);
    db.exec("BEGIN IMMEDIATE");
    try{let state=mutate(read(),a,"createItem",v);const item=state.items.at(-1)!;
      state=mutate(state,a,"updateItem",{itemId:item.id,...v});
      if(v.mediaId){if(!db.prepare("SELECT 1 FROM life_media WHERE id=? AND owner=?").get(v.mediaId,a))throw new AgentError("照片未获授权",403);item.photo=`/api/life/media/${v.mediaId}?actor=${a}`;}
      if(v.packId)state=mutate(state,a,"bindProduct",{itemId:item.id,packId:v.packId,confirmed:v.confirmed});
      db.prepare("UPDATE workspace SET body=? WHERE id=1").run(JSON.stringify(state));db.exec("COMMIT");return Response.json({item});
    }catch(e){db.exec("ROLLBACK");throw e;}
  }
  if(p.action==="fragment")return Response.json({fragment:saveFragment(db,read,a,p.input)});
  if(p.action==="deleteFragment"){const v=z.object({id:z.string().uuid(),revision:z.number().int().positive()}).parse(p.input);deleteFragment(db,read(),a,v.id,v.revision);return Response.json({ok:true});}
  if(p.action==="source"){
    const v=z.object({itemId:z.string().min(1).max(100),title:z.string().min(1).max(150),text:z.string().min(10).max(40000),url:z.string().max(2000).optional(),kind:z.enum(["user-manual","user-link","user-text"])}).parse(p.input);
    return Response.json({id:saveSource(db,read(),a,v)});
  }
  if(p.action==="discover"){
    const v=z.object({goal:z.string().max(500).default("发现新用途"),itemId:z.string().optional(),minutes:z.number().int().min(1).max(240).optional(),includeSynthetic:z.boolean().default(false),model:z.boolean().default(false)}).parse(p.input);
    return Response.json({ideas:v.model?[await modelIdea(db,read(),a,v.goal,lifeProvider(),v.includeSynthetic)]:discoverLife(db,read(),a,v)});
  }
  if(p.action==="ideaFeedback"){feedbackIdea(db,read(),a,p.input);return Response.json({ok:true});}
  if(p.action==="updateItem"){const v=z.object({itemId:z.string().min(1),name:z.string().optional(),state:z.string().optional(),availability:z.string().optional(),attributes:z.record(z.string(),z.unknown()).optional(),shared:z.boolean().optional()}).parse(p.input);return Response.json({workspace:visible(write(a,"updateItem",v),a)});}
  throw new AgentError("不支持的操作");
}catch(e){return fail(e);}}
