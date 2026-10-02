'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {NodeTextSource,sha}=require('./helpers/mobileHarness.cjs');
const {importTxtSourceStreaming}=require('../dist/application/import/streamingTxtImport');
const {makeBase64NativeByteSha}=require('../dist/application/import/byteShaAdapter');

function store(){const shards=[],windows=[];let reads=0;return{shards,windows,get reads(){return reads},async saveShard(s){shards.push(s)},async readRange(id,start,end){reads++;windows.push(end-start);return shards.filter(s=>s.endCp>start&&s.startCp<end).map(s=>Array.from(s.text).slice(Math.max(0,start-s.startCp),Math.min(s.endCp,end)-s.startCp).join('')).join('')}}}
test('bounded import hash batches preserve every UTF8/GBK digest, mirror coordinate and ID while reducing source reads',async()=>{
 const long=Buffer.from(Array.from({length:100},(_,i)=>`第${i+1}章\r\n${'林辰在旧桥看见石阶🙂。'.repeat(140)}\r\n`).join(''));
 for(const bytes of [long,Buffer.from('b5dad2bbd5c20d0ad6d0cec4c8cecef10d0a','hex')]){
  const legacy=store(),batched=store();let calls=0;
  const options={readWindowBytes:257,sha256Hex:sha.sha256Hex,sha256BytesHex:sha.sha256BytesHex};
  const a=await importTxtSourceStreaming(new NodeTextSource(bytes),legacy,'same',options);
  const b=await importTxtSourceStreaming(new NodeTextSource(bytes),batched,'same',{...options,async sha256BytesBatchHex(inputs){calls++;assert.ok(inputs.length<=16);assert.ok(inputs.reduce((n,b)=>n+b.byteLength,0)<=1048576);return Promise.all(inputs.map(v=>sha.sha256BytesHex(v)))}});
  assert.deepEqual(b,a);assert.ok(calls>0);assert.ok(batched.reads<Math.max(3,b.chapters.length+b.chunks.length));assert.ok(batched.windows.every(cp=>cp<=65536));
 }
});
test('batch byte bridge hashes each supplied sequence and rejects missing or malformed results',async()=>{
 const seen=[];const provider=makeBase64NativeByteSha({sha256Hex:sha.sha256Hex,sha256BytesHexFromBase64:value=>sha.sha256BytesHex(Buffer.from(value,'base64')),async sha256BytesBatchHexFromBase64(values){seen.push(...values);return Promise.all(values.map(v=>sha.sha256BytesHex(Buffer.from(v,'base64'))))}});
 const inputs=[Buffer.from('第一章'),Buffer.from([0,255,3]),Buffer.from('🙂')];
 assert.deepEqual(await provider.sha256BytesBatchHex(inputs),await Promise.all(inputs.map(v=>sha.sha256BytesHex(v))));assert.deepEqual(seen.map(v=>Buffer.from(v,'base64')),inputs);
 const broken=makeBase64NativeByteSha({sha256Hex:sha.sha256Hex,sha256BytesHexFromBase64:async()=>'',sha256BytesBatchHexFromBase64:async()=>['not-a-hash']});await assert.rejects(broken.sha256BytesBatchHex(inputs),/invalid_batch_digests/);
});
test('missing import shard coverage fails before source activation',async()=>{
 const s=store();s.readRange=async()=>'';
 await assert.rejects(importTxtSourceStreaming(new NodeTextSource(Buffer.from('第一章\n林辰在旧桥。')),s,'s',{sha256Hex:sha.sha256Hex,sha256BytesHex:sha.sha256BytesHex}),/import_shard_coverage_missing/);
});
