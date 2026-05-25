const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxy) {
  const { ProxyAgent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new ProxyAgent(proxy));
  console.log('[proxy-bootstrap] HTTPS proxy activo:', proxy);
}
