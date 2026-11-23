const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let calls = 0, fail = false, release;
const wait = new Promise(resolve => release = resolve);
const project = {slug:'p', mediaGeneration:{imageModel:'model'}, locations:[{id:'new',name:'Cafe',description:'Cafe environment',referenceImagePath:''},{id:'old',name:'Dining',referenceImagePath:'old.png'}]};
const data = {projects:[project], activities:[]};
const providerInputs = [];
const mock = {
 './provider-submission-checkpoint': {withProviderSubmissionCheckpoint: async (_checkpoint, work)=>work()},
 './media-provider': {generateMaiVideoProfileImage: async input => {
   calls++; providerInputs.push(input);
   await input.onJobCreated('provider-task');
   await wait;
   if (fail) throw new Error('Provider unavailable');
   return {localPath:'cafe.png'};
 }},
 './server-store': {now:()=> 'now', makeActivity:x=>x, readDataForUser:async user=>{assert.equal(user,'owner'); return structuredClone(data);}, updateDataForUser:async(user,fn)=>{assert.equal(user,'owner');return fn(data);}}
};
const context = {exports:{}, require:name=>mock[name]};
vm.createContext(context);
vm.runInContext(ts.transpile(fs.readFileSync('app/lib/location-reference-generation.ts','utf8'),{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}),context);
(async()=>{
 const {ensureLocationReference: ensure} = context.exports;
 const first = ensure('owner','p','new');
 const second = ensure('owner','p','new');
 assert.equal(first,second,'Scene workers share the same in-flight operation');
 release();
 await Promise.all([first,second]);
 assert.equal(calls,1);
 assert.equal(project.locations[0].referenceImagePath,'cafe.png');
 assert.equal(project.locations[0].imageGeneration.status,'ready');
 assert.equal(providerInputs[0].userId,'owner');
 await ensure('owner','p','old');
 assert.equal(calls,1,'Never regenerate an existing reference');
 project.locations.push({id:'bad',name:'Backyard',description:'Backyard',referenceImagePath:''});
 fail = true;
 await assert.rejects(ensure('owner','p','bad'),/Provider unavailable/);
 const bad = project.locations[2];
 assert.equal(bad.imageGeneration.status,'failed');
 assert.equal(bad.imageGeneration.jobId,'provider-task','Persist checkpoint for resume, no duplicate submission');
 assert.equal(bad.referenceImagePath,'');
 assert.equal(data.activities.length,1);
 fail = false;
 await ensure('owner','p','bad');
 assert.equal(providerInputs.at(-1).existingJobId,'provider-task');
 assert.equal(bad.imageGeneration.status,'ready');
 console.log('Passed: single-flight generation, owner isolation, preserve existing images, visible failures and checkpoint resume.');
})().catch(error=>{console.error(error);process.exitCode=1;});
