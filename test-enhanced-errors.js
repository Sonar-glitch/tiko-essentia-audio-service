const fetch = require('node-fetch');

async function testEnhancedErrors() {
  console.log('🧪 Testing enhanced error reporting with failing artists...');
  
  const testArtists = ['Holywatr', 'Noize MC', 'Monetochka'];
  
  for (const artistName of testArtists) {
    console.log(`\n🎤 Testing: ${artistName}`);
    console.log('='.repeat(50));
    
    try {
      const response = await fetch('https://tiko-essentia-audio-service-2eff1b2af167.herokuapp.com/api/analyze-artist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistName: artistName,
          maxTracks: 5
        })
      });
      
      const result = await response.json();
      console.log('📊 Response Status:', response.status);
      console.log('✅ Success:', result.success);
      console.log('❌ Basic Error:', result.error);
      
      if (result.detailedError) {
        console.log('\n📋 Detailed Analysis:');
        console.log(result.detailedError);
      }
      
      if (result.failureAnalysis) {
        console.log('\n🔍 Failure Breakdown:');
        console.log('- Spotify Search:', result.failureAnalysis.spotifySearch);
        console.log('- Tracks Found:', result.failureAnalysis.tracksFound);
        console.log('- Preview URLs:', result.failureAnalysis.tracksWithPreviewUrls);
        console.log('- Genres Available:', result.failureAnalysis.genresAvailable);
        console.log('- Spotify ID Available:', result.failureAnalysis.spotifyId);
        console.log('- Alternative Sources Attempted:', result.failureAnalysis.alternativeSourcesAttempted);
      }
      
    } catch (error) {
      console.log('❌ Network Error:', error.message);
    }
  }
  
  console.log('\n🎯 Summary: Enhanced error reporting now shows:');
  console.log('- Which sources were attempted (Spotify, Apple, alternatives)');
  console.log('- How many tracks were found vs analyzable');
  console.log('- Whether credentials were available');
  console.log('- Specific SoundCloud API error codes');
  console.log('- Genre availability for fallback inference');
}

testEnhancedErrors().catch(console.error);
