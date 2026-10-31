import type { AcquiredDocument } from "../life/acquisition.ts";
import { fingerprint } from "./legacy.ts";

// A deliberately small, source-reviewed index, not a generic semantic verifier.
// An atom exists only while its exact official URL/model/region and anchor remain present.
// No model-supplied stance, quote or URL may register an atom.
export const sourceReviews = [
  {model:"WH-CH520",region:"unspecified",url:"https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000776852.html",predicate:"subsequent_pairing_hold_seconds",value:5,quote:"for about 5 seconds or more",description:"已有配对信息、连接后续设备时，手动进入配对模式需约5秒或更久；不是初始化。"},
  {model:"WH-CH520",region:"unspecified",url:"https://helpguide.sony.net/mdr/2958/v1/en/contents/TP1000783325.html",predicate:"initialize_hold_seconds",value:10,quote:"for about 10 seconds or more",description:"指南中的初始化需先关机、移除USB线，再按电源与音量减约10秒或更久；会删除配对信息。"},
  {model:"M185",region:"my",url:"https://support.logi.com/hc/en-my/articles/360023241934-M185-Technical-Specifications",predicate:"battery",value:"1xAA alkaline",quote:"Battery Type and Size 1xAA Alkaline, Removable/ Replaceable",description:"规格表：一节可更换AA碱性电池。实际电池状态仍需用户确认。"},
  {model:"M185",region:"my",url:"https://support.logi.com/hc/en-my/articles/360023241934-M185-Technical-Specifications",predicate:"receiver_bluetooth_feature",value:"N/A",quote:"Bluetooth Feature N/A",description:"该接收器规格的Bluetooth Feature为N/A；这不是任意型号鼠标的完整能力声明，不补造手机蓝牙连接步骤。"},
  {model:"494.408.37",region:"jp",url:"https://www.ikea.com/jp/en/p/samla-box-with-lid-transparent-s49440837/",predicate:"food_contact_approved",value:false,quote:"Not approved for food contact.",description:"该日本站SKU明确未获食品接触批准；不是从缺少信息推断。"},
  {model:"Osmo Mobile 6",region:"unspecified",url:"https://www.dji.com/osmo-mobile-6/specs",predicate:"phone_weight_g",value:[170,290],quote:"Compatible Phone Weight 170-290 g",description:"手机重量范围170—290克；满足重量只是必要条件，不证明尺寸、软件或完整兼容性。"},
  {model:"Osmo Mobile 6",region:"unspecified",url:"https://dl.djicdn.com/downloads/DJI_Osmo_Mobile_6/UM/20260520/Osmo_Mobile_6_User_Manual_V1.8_en.pdf",predicate:"phone_weight_g",value:[170,290],quote:"Compatible Phone Weight 170-290 g",description:"V1.8英文说明书的手机重量范围170—290克；还须核对宽度、厚度及软件适用条件，不能当作完整兼容结论。"},
] as const;
export type FactValue = string | boolean | number | readonly number[];
const verified=Symbol("server-reviewed-atom");
export type ReviewedFact = {
  [verified]:true; model:string;region:string;firmware:string;predicate:string;value:FactValue;description:string;
  basis:"official_direct";source:{url:string;documentId:string;hash:string;quote:string;fetchedAt:string};
};
const normalized=(s:string)=>s.normalize("NFKC").replace(/\s+/g," ").trim();
export function bindReviewedFacts(documents:AcquiredDocument[]):ReviewedFact[] {
  return documents.flatMap(d=>sourceReviews.filter(r=>r.url===d.url&&r.model.toUpperCase()===d.model.toUpperCase()&&r.region===d.region&&normalized(d.text).includes(normalized(r.quote))).map(r=>({
    [verified]:true as const,model:r.model,region:r.region,firmware:"unknown",predicate:r.predicate,value:r.value,description:r.description,basis:"official_direct" as const,
    source:{url:d.url,documentId:d.id,hash:d.hash,quote:r.quote,fetchedAt:d.fetchedAt},
  })));
}
export function checkProposition(input:{model:string;region:string;firmware?:string;predicate:string;value:FactValue}, facts:ReviewedFact[]) {
  const applicable=facts.filter(f=>f[verified]===true&&f.model.toUpperCase()===input.model.toUpperCase()&&f.region===input.region&&(!input.firmware||input.firmware==="unknown"||input.firmware===f.firmware)&&f.predicate===input.predicate);
  const values=new Set(applicable.map(f=>fingerprint(f.value)));
  const verdict=values.size>1?"conflicting":!applicable.length?"not_found":fingerprint(input.value)===fingerprint(applicable[0].value)?"supported":"refuted";
  return {predicate:input.predicate,value:input.value,verdict,basis:applicable.length?"official_direct":"insufficient_evidence",facts:applicable,
    notice:"仅核对已审阅的原子主张和适用范围；资料未提及不等于否定，未覆盖语义不得扩写。"};
}
export const factLabels:Record<string,string>={battery:"电池规格",receiver_bluetooth_feature:"接收器的蓝牙规格字段",food_contact_approved:"食品接触批准",phone_weight_g:"手机重量范围",subsequent_pairing_hold_seconds:"后续设备配对时长",initialize_hold_seconds:"初始化时长",repair_cost:"维修费用",repair_price:"维修费用",warranty_void_if_self_repair:"自行拆修是否影响保修",user_serviceable_battery:"电池能否自行拆修",anc_supported:"主动降噪能力",active_noise_cancellation:"主动降噪能力"};
