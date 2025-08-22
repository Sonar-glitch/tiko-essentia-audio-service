(async()=>{
  const { MongoClient } = require('mongodb');
  const uri = process.env.MONGODB_URI;
  if(!uri){ console.error('MONGODB_URI missing'); process.exit(2); }
  const client = await MongoClient.connect(uri, { useNewUrlParser:true, useUnifiedTopology:true });
  try{
    const col = client.db().collection('artistGenres');
    const docs = await col.find({essentiaProfileBuilt:true}).project({_id:1,name:1,essentiaAudioProfile:1,essentiaProfileDate:1}).toArray();
    const totalBuilt = docs.length;
    const builtWithMatrix = docs.filter(d=>Array.isArray(d.essentiaAudioProfile && d.essentiaAudioProfile.trackMatrix) && d.essentiaAudioProfile.trackMatrix.length>0).length;
    const builtWithoutMatrix = totalBuilt - builtWithMatrix;
    const sample = docs.filter(d=>!(Array.isArray(d.essentiaAudioProfile && d.essentiaAudioProfile.trackMatrix) && d.essentiaAudioProfile.trackMatrix.length>0)).slice(0,200).map(d=>({_id:d._id,name:d.name||null,essentiaProfileDate:d.essentiaProfileDate||null}));
    const clearIds = sample.slice(0,20).map(d=>d._id);
    let cleared = 0;
    if(clearIds.length>0){
      const res = await col.updateMany({_id:{$in:clearIds}},{$unset:{essentiaProfileBuilt:'',essentiaProfileDate:''}});
      cleared = res.modifiedCount || 0;
    }
    console.log(JSON.stringify({totalBuilt,builtWithMatrix,builtWithoutMatrix,sampleCount:sample.length,cleared,clearIds,sample},null,2));
  }catch(e){
    console.error(e&&e.message);
    process.exit(1);
  }finally{
    await client.close();
  }
  process.exit(0);
})();
