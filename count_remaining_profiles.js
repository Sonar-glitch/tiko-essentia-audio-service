const { MongoClient } = require('mongodb');
(async () => {
  try {
    if (!process.env.MONGODB_URI) {
      console.error('MONGODB_URI missing');
      process.exit(2);
    }
    const client = await MongoClient.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    const db = client.db();
    const col = db.collection('artistGenres');
    const q = { $or: [ { essentiaAudioProfile: { $exists: false } }, { 'essentiaAudioProfile.trackMatrix': { $exists: false } }, { 'essentiaAudioProfile.trackMatrix': { $size: 0 } } ] };
    const n = await col.countDocuments(q);
    console.log('remaining_need_profile_count=', n);
    // print a tiny sample of _ids to help inspection
    const sample = await col.find(q, { projection: { _id: 1, name: 1 } }).limit(5).toArray();
    console.log('sample_docs=', JSON.stringify(sample));
    await client.close();
    process.exit(0);
  } catch (e) {
    console.error('error', e && e.message);
    process.exit(1);
  }
})();
