import { createProvider } from "../ai/provider.ts";
/** Separate task authorization from a historical .env.local paid flag. */
export function lifeProvider(){return createProvider({...process.env,AI_ALLOW_PAID_CALLS:process.env.WUJIAN_ALLOW_PAID_CALLS==="true"?process.env.AI_ALLOW_PAID_CALLS:"false"});}
