const { MongoClient } = require('mongodb');
(async () => {
  try {
    if (!process.env.MONGODB_URI) { console.error('MONGODB_URI missing'); process.exit(2); }
    const client = await MongoClient.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    const db = client.db();
    const col = db.collection('artistGenres');
    const q = { $or: [ { name: { $exists: false } }, { name: null }, { name: "" } ] };
    const update = [ { $set: { name: { $ifNull: [ "$originalName", "$artistName", "$displayName", { $toString: "$_id" } ] } } } ];
    const res = await col.updateMany(q, update);
    console.log('matchedCount=', res.matchedCount, 'modifiedCount=', res.modifiedCount);
    await client.close();
    process.exit(0);
  } catch (e) {
    console.error('error', e && e.message);
    process.exit(1);
  }
})();
