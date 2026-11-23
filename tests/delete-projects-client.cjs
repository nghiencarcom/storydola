const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const context = {exports:{}};
vm.createContext(context);
vm.runInContext(ts.transpile(fs.readFileSync('app/lib/delete-projects-client.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),context);
(async()=>{
 const calls=[];
 const result=await context.exports.deleteSelectedProjects(['ok','busy','other-user','ok','last'],async slug=>{
  calls.push(slug);
  if(slug==='busy') throw new Error('Project đang chạy tác vụ.');
  if(slug==='other-user') throw new Error('Không tìm thấy project.');
 });
 assert.equal(JSON.stringify(calls),JSON.stringify(['ok','busy','other-user','last']));
 assert.equal(JSON.stringify(result.deleted),JSON.stringify(['ok','last']));
 assert.equal(result.failed.length,2);
 assert.equal(result.failed[0].slug,'busy');
 assert.equal(result.failed[1].slug,'other-user');
 const empty=await context.exports.deleteSelectedProjects([],()=>{throw new Error('Must not run');});
 assert.equal(empty.deleted.length,0);
 assert.equal(empty.failed.length,0);
 console.log('Passed: explicit selection only, deduplication, partial failures, continue after busy/missing project and empty selection.');
})().catch(error=>{console.error(error);process.exitCode=1;});
