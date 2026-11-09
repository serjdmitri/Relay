// Bound bytes while reading, before decoding. Shared by external-service clients.
async function readText(response, { maxBytes = 2000000, signal } = {}) {
  signal?.throwIfAborted();
  if (Number(response.headers?.get?.('content-length')) > maxBytes) throw Error('Response exceeds the size limit.');
  if (!response.body?.[Symbol.asyncIterator]) {
    const text = await response.text(); // test adapters; fetch Responses use the bounded stream below
    signal?.throwIfAborted();
    if (Buffer.byteLength(text) > maxBytes) throw Error('Response exceeds the size limit.');
    return text;
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    signal?.throwIfAborted(); bytes += chunk.length;
    if (bytes > maxBytes) throw Error('Response exceeds the size limit.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
module.exports = { readText };
