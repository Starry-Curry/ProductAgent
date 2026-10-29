// Isolated acceptance child only: fake credential, paid traffic goes through one task ledger.
const original = globalThis.fetch;
globalThis.fetch = (url, init) => {
  if (String(url).startsWith("https://fixture.invalid/v1/"))
    return original(
      process.env.ALPHA_GATEWAY + "/browser/v1/" + String(url).split("/v1/")[1],
      init,
    );
  return original(url, init);
};
