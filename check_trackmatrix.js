const { MongoClient } = require('mongodb');
(async ()=>{
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db();
  const top = await db.collection('artistGenres').countDocuments({ essentiaTrackMatrix: { $exists: true } });
  console.log('top-level essentiaTrackMatrix exists:', top);
  const nestedExists = await db.collection('artistGenres').countDocuments({ 'essentiaAudioProfile.trackMatrix': { $exists: true } });
  console.log('nested essentiaAudioProfile.trackMatrix exists:', nestedExists);
  const agg = await db.collection('artistGenres').aggregate([
    { $project: { len: { $size: { $ifNull: [ '$essentiaAudioProfile.trackMatrix', [] ] } } } },
    { $group: { _id: null, totalWithLen: { $sum: { $cond: [ { $gt: [ '$len', 0 ] }, 1, 0 ] } }, avgLen: { $avg: '$len' } } }
  ]).toArray();
  console.log('aggregation:', JSON.stringify(agg, null, 2));
  await c.close();
})();
