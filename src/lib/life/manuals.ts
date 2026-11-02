/** A PDF suffix is a transport format, not evidence that a file is a product manual. */
export function unrelatedDocument(link:{title:string;url:string}){
 let url=link.url;try{url=decodeURI(url);}catch{}
 return /算法|备案|隐私|法律|营业执照|许可证|营销|促销|algorithm|filing|privacy|legal|license|licence|certificate|conformity|brochure|catalogue|marketing/i.test(url+' '+link.title);
}
export function isProductManual(link: { title: string; url: string }) {
  let url = link.url;
  try {
    url = decodeURI(url);
  } catch {
    /* Invalid escapes are not evidence of a manual. */
  }
  const text = url + " " + link.title;
  if (unrelatedDocument(link)) return false;
  return /assembly[_-]instructions|product\.bi\.core\.pdf|user[ _%-]*(?:guide|manual)|(?:operation|instruction)[ _%-]*(?:guide|manual)|instructions[ _%-]*for[ _%-]*use|quick[ _%-]*(?:start|guide|installation)|installation[ _%-]*guide|(?:^|[\s/_-])(?:qsg|qig|ug)(?:[\s/_.-]|$)|说明书|組裝|组装|使用手冊|使用手册|操作指南/i.test(
    text,
  );
}
