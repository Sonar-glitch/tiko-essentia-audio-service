const { MongoClient } = require('mongodb');
(async ()=>{
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db();
  const res = await db.collection('artistGenres').updateMany({ essentiaTrackMatrix: { $exists: true } }, { $unset: { essentiaTrackMatrix: '' } });
  console.log('updateMany result:', res.result || res);
  await c.close();
})();
