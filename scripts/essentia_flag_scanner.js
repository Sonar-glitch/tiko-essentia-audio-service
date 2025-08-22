#!/usr/bin/env node
/**
 * Scanner: find artistGenres docs where essentiaProfileBuilt:true but the profile is missing or empty.
 * Usage: node scripts/essentia_flag_scanner.js --dryRun
 * Options:
 *   --clear   : unset the flags for the found docs so they can be picked up by the resume batch
 *   --limit N : only process the first N docs (default 500)
 */

const { MongoClient } = require('mongodb');
const args = process.argv.slice(2);
function hasFlag(n){ return args.includes('--'+n); }
function getArg(n,def){ const i = args.indexOf('--'+n); return i===-1?def:args[i+1]; }

(async()=>{
  const MONGODB_URI = process.env.MONGODB_URI;
  if(!MONGODB_URI){ console.error('Missing MONGODB_URI'); process.exit(2); }
  const client = await MongoClient.connect(MONGODB_URI, { useNewUrlParser:true, useUnifiedTopology:true });
  const col = client.db().collection('artistGenres');
  const limit = parseInt(getArg('limit', '500'), 10);
  const clear = hasFlag('clear');
  const dryRun = hasFlag('dryRun') || hasFlag('dry');

  try{
    const cursor = col.find({ essentiaProfileBuilt:true }).project({_id:1,name:1,essentiaAudioProfile:1,essentiaProfileDate:1});
    let checked = 0; let toClear = [];
    while(await cursor.hasNext() && checked < limit){
      const doc = await cursor.next();
      checked++;
      const hasMatrix = Array.isArray(doc.essentiaAudioProfile && doc.essentiaAudioProfile.trackMatrix) && doc.essentiaAudioProfile.trackMatrix.length>0;
      if(!hasMatrix){
        toClear.push({_id:doc._id,name:doc.name||null,essentiaProfileDate:doc.essentiaProfileDate||null});
      }
    }

    console.log(JSON.stringify({checked,found:toClear.length,sample:toClear.slice(0,50)},null,2));

    if(clear && toClear.length>0){
      if(dryRun){ console.log('dryRun enabled; not clearing flags'); }
      else{
        const ids = toClear.map(d=>d._id);
        const op = {}; op[String.fromCharCode(36)+'unset'] = { essentiaProfileBuilt:'', essentiaProfileDate:'' };
        const res = await col.updateMany({_id:{ $in: ids }}, op);
        console.log('cleared', res.modifiedCount);
      }
    }

    await client.close();
  }catch(e){ console.error(e&&e.message); process.exit(1); }
  process.exit(0);
})();
