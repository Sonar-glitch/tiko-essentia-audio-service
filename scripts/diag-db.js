const { MongoClient } = require('mongodb');
(async ()=>{
  const uri = process.env.MONGODB_URI;
  if(!uri){ console.error('MONGODB_URI missing'); process.exit(2); }
  const client = await MongoClient.connect(uri, { useNewUrlParser:true, useUnifiedTopology:true });
  const db = client.db();
  const artistCol = db.collection('artistGenres');
  const audioCol = db.collection('audio_features');

  const totalArtistDocs = await artistCol.countDocuments();
  const sampleArtists = await artistCol.find({}, { projection: { _id:1, name:1, spotifyId:1 } }).limit(10).toArray();

  const totalAudioDocs = await audioCol.countDocuments();
  const totalEssentiaDocs = await audioCol.countDocuments({ 'features.analysis_source': 'essentia' });
  const distinctAudioArtists = await audioCol.distinct('artist');
  const distinctAudioArtistsEss = await audioCol.distinct('artist', { 'features.analysis_source': 'essentia' });

  const sampleAudio = await audioCol.find({}, { projection: { _id:1, artist:1, spotifyId:1, 'features.analysis_source':1 } }).limit(10).toArray();

  // check name overlap heuristic: how many artistGenres.names appear in audio_features.artist
  const artistNames = await artistCol.distinct('name');
  const namesInAudioCount = await audioCol.countDocuments({ artist: { $in: artistNames.slice(0,2000) } });

  console.log(JSON.stringify({
    totalArtistDocs,
    totalAudioDocs,
    totalEssentiaDocs,
    distinctAudioArtistsCount: distinctAudioArtists.length,
    distinctAudioArtistsEssCount: distinctAudioArtistsEss.length,
    sampleArtists,
    sampleAudio,
    namesInAudioCount
  }, null, 2));
  await client.close();
})();
