const { MongoClient } = require('mongodb');
(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }
  const client = await MongoClient.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  const db = client.db();
  const artistCol = db.collection('artistGenres');
  const audioCol = db.collection('audio_features');

  const missingQ = { $or:[ {essentiaAudioProfile:{$exists:false}}, {'essentiaAudioProfile.trackMatrix':{$exists:false}}, {'essentiaAudioProfile.trackMatrix':{$size:0}} ] };
  const missingArtistsCount = await artistCol.countDocuments(missingQ);

  const agg = await audioCol.aggregate([
    { $match: { 'features.analysis_source': 'essentia' } },
    { $group: { _id: '$artist', count: { $sum: 1 } } },
    { $count: 'artistsWithEss' }
  ]).toArray();
  const artistsWithEss = agg[0] ? agg[0].artistsWithEss : 0;

  console.log(JSON.stringify({ missingArtistsCount, artistsWithEss }, null, 2));
  await client.close();
  process.exit(0);
})();

// Local usage: node scripts/count_missing.js (requires MONGODB_URI env)
