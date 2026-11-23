const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file) {
  file = path.resolve(file);
  const exports = {};
  const context = { exports, require: name => name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name) };
  vm.createContext(context);
  vm.runInContext(ts.transpile(fs.readFileSync(file, 'utf8'), {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}), context);
  return exports;
}
const { reconcileEpisodeLocations: reconcile } = load('app/lib/episode-locations.ts');
const existing = [{id:'dining', name:'Phòng ăn', aliases:['Dining room'], description:'Original layout', referenceImagePath:'existing.png'}];
const payload = {
 location_bible: [{name:'Quán cà phê',description:'Small cafe, entrance north, counter west.',image_prompt:'Small cafe with a north entrance and west counter.'}, {name:'Unused park',description:'Not in this episode.'}, {name:'Phòng ăn',description:'Conflicting redesign'}],
 scenes: [{id:'S021',location_name:'Quán cà phê',location_id:'dining',image_reference_location_id:'dining'}, {id:'S022',location_name:'Dining room'}, {id:'S023',location_name:'Quán cà phê'}]
};
const result = reconcile(existing,payload,'now');
assert.equal(result.addedIds.length,1);
assert.equal(result.locations.length,2);
assert.equal(result.locations[0].referenceImagePath,'existing.png');
assert.equal(result.locations[0].description,'Original layout');
assert.equal(result.scenes[0].image_reference_location_id,result.addedIds[0]);
assert.equal(result.scenes[0].video_reference_location_id,result.addedIds[0]);
assert.equal(result.scenes[1].location_name,'Phòng ăn');
assert.equal(result.scenes[1].location_id,'dining');
assert.equal(result.scenes[2].location_id,result.addedIds[0]);
assert.equal(existing.length,1,'No mutation of input');
assert.equal(payload.scenes[0].location_id,'dining');
assert.equal(reconcile(result.locations,payload,'later').addedIds.length,0,'Reimport must reuse canon');
assert.equal(reconcile(existing,{scenes:[{location_name:'phong an'}],location_bible:[]},'now').addedIds.length,0);
assert.equal(reconcile(existing,{scenes:[{location_name:'Sân sau',location_description:'Walled rear courtyard.'}]},'now').addedIds.length,1);
assert.throws(()=>reconcile(existing,{scenes:[{location_name:'Unknown room'}]},'now'),/cần description/);
assert.equal(reconcile(existing,{scenes:[{id:'S1',location_name:''}]},'now').scenes[0].location_id,undefined,'Never silently select first room');
assert.equal(reconcile(existing,{scenes:[],location_bible:payload.location_bible},'now').addedIds.length,0,'No quota or unused profiles');
console.log('Passed: used-only new locations, canonical reuse, aliases, assignment correction, dedup, import idempotence and missing-definition guard.');
