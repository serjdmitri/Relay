// Bound bytes while reading, before decoding. Shared by external-service clients.
async function readText(response, { maxBytes = 2000000, signal, truncate = false } = {}) {
  signal?.throwIfAborted();
  if (!truncate && Number(response.headers?.get?.('content-length')) > maxBytes) { await response.body?.cancel?.().catch(()=>{}); throw Error('Response exceeds the size limit.'); }
  if (!response.body?.[Symbol.asyncIterator]) {
    const text = await response.text(); // test adapters; fetch Responses use the bounded stream below
    signal?.throwIfAborted();
    if (Buffer.byteLength(text) > maxBytes) { if(truncate)return Buffer.from(text).subarray(0,maxBytes).toString('utf8'); throw Error('Response exceeds the size limit.'); }
    return text;
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    signal?.throwIfAborted();
    if (bytes + chunk.length > maxBytes) { if(truncate){chunks.push(Buffer.from(chunk).subarray(0,maxBytes-bytes));break;} throw Error('Response exceeds the size limit.'); }
    bytes += chunk.length;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
module.exports = { readText };
