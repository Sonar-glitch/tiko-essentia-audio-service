const fetch = require('node-fetch');

async function testSoundCloudAPI() {
  console.log('🔍 Testing current SoundCloud API keys...');
  
  const clientIds = [
    'lcKCKyUaMW1dgS42vr9wdJkSmrGRZcGh',
    'iZIs9mchVcX5lhVRyQGGAYlNPVldzAoJ', 
    'fDoItMDbsbZz8dY16ZzARCZmzgHBPotA'
  ];
  
  for (const clientId of clientIds) {
    try {
      console.log(`\n🔑 Testing client ID: ${clientId.substring(0, 8)}...`);
      
      const response = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=test&client_id=${clientId}&limit=1`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      console.log(`📊 Status: ${response.status} ${response.statusText}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log(`❌ Error details: ${errorText.substring(0, 200)}`);
        
        if (response.status === 401) {
          console.log('   → 401 means: Invalid/expired client ID');
        } else if (response.status === 403) {
          console.log('   → 403 means: Client ID suspended or rate limited');
        }
      } else {
        const data = await response.json();
        console.log(`✅ SUCCESS! Found ${data.collection?.length || 0} tracks`);
        console.log('   → This client ID is working!');
        break;
      }
    } catch (error) {
      console.log(`❌ Network error: ${error.message}`);
    }
  }
  
  console.log('\n📋 SoundCloud API Registration Instructions:');
  console.log('1. Visit: https://soundcloud.com/you/apps');
  console.log('2. Click "Register a new application"');
  console.log('3. Fill required fields:');
  console.log('   - App Name: TIKO Audio Analysis');
  console.log('   - Website: https://your-domain.com (can be placeholder)');
  console.log('   - Redirect URI: LEAVE BLANK (not needed for search API)');
  console.log('4. Submit and get your Client ID');
  console.log('5. Add to environment: SOUNDCLOUD_CLIENT_ID=your_new_client_id');
  
  console.log('\n⚠️ Note: No callback/redirect URI needed for basic search API calls');
}

testSoundCloudAPI().catch(console.error);
