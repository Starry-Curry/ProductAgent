// Isolated acceptance child only: fake credential, paid traffic goes through one task ledger.
const original = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const address=String(url);
  if(process.env.ALPHA_GATEWAY&&/^https:\/\/dashscope\.aliyuncs\.com\/api\/v1\/services\/aigc\/(text|multimodal)-generation\/generation$/.test(address))
    return original(process.env.ALPHA_GATEWAY+'/browser/'+address.split('/aigc/')[1],init);
  if(process.env.ALPHA_GATEWAY&&address.startsWith('https://dashscope.aliyuncs.com/compatible-mode/v1/'))
    return original(process.env.ALPHA_GATEWAY+'/browser/v1/'+address.split('/v1/')[1],init);
  if (String(url).startsWith("https://fixture.invalid/v1/"))
    return original(
      process.env.ALPHA_GATEWAY + "/browser/v1/" + String(url).split("/v1/")[1],
      init,
    );
  return original(url, init);
};
