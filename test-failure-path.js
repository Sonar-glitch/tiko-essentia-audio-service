const fetch = require('node-fetch');

async function testFailurePath() {
  console.log('🧪 Testing with completely unknown artist...');
  
  const response = await fetch('https://tiko-essentia-audio-service-2eff1b2af167.herokuapp.com/api/analyze-artist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      artistName: 'XYZ_NONEXISTENT_ARTIST_12345',
      maxTracks: 5
    })
  });
  
  const result = await response.json();
  console.log('\n📊 Response for nonexistent artist:');
  console.log('Success:', result.success);
  console.log('Error:', result.error);
  
  if (result.detailedError) {
    console.log('\n📋 Detailed Error:');
    console.log(result.detailedError);
  }
  
  if (result.failureAnalysis) {
    console.log('\n🔍 Failure Analysis:');
    Object.entries(result.failureAnalysis).forEach(([key, value]) => {
      console.log(`- ${key}: ${value}`);
    });
  }
  
  console.log('\n🎯 This shows the complete source exhaustion path!');
}

testFailurePath().catch(console.error);
