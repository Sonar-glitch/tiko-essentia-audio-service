#!/usr/bin/env node
/**
 * TEST ENHANCED AUDIO SOURCES
 * Tests all fallback strategies with real examples
 */

const { findAlternativeAudioSource, searchSpotifyPreviewUrl, inferAudioFeaturesFromGenres } = require('./enhanced-audio-sources');

async function testEnhancedSources() {
  console.log('🧪 TESTING ENHANCED AUDIO SOURCES');
  console.log('=================================');
  
  const testCases = [
    { artist: 'FISHER', track: 'Losing It' },
    { artist: 'Charlotte de Witte', track: 'Doppler' },
    { artist: 'Deadmau5', track: 'Strobe' },
    { artist: 'Amelie Lens', track: 'Higher' },
    { artist: 'Unknown Artist', track: 'Unknown Track' } // Edge case
  ];
  
  for (const testCase of testCases) {
    console.log(`\n🎵 Testing: ${testCase.artist} - ${testCase.track}`);
    console.log('─'.repeat(50));
    
    const startTime = Date.now();
    
    try {
      // Test enhanced alternative source search
      const result = await findAlternativeAudioSource(
        testCase.artist, 
        testCase.track, 
        null,
        {
          clientId: process.env.SPOTIFY_CLIENT_ID,
          clientSecret: process.env.SPOTIFY_CLIENT_SECRET
        }
      );
      
      const searchTime = Date.now() - startTime;
      
      console.log(`⏱️  Search completed in ${searchTime}ms`);
      console.log(`📊 Found ${result.totalSources} sources`);
      console.log(`🎯 Has direct stream: ${result.hasDirectStream}`);
      console.log(`🔄 Recommended action: ${result.recommendedAction}`);
      
      if (result.bestSource) {
        const best = result.bestSource;
        console.log(`\n🏆 BEST SOURCE:`);
        console.log(`   Source: ${best.source}`);
        console.log(`   Priority Score: ${best.priorityScore?.toFixed(2)}`);
        console.log(`   Confidence: ${best.confidence?.toFixed(2)}`);
        console.log(`   Has Stream URL: ${!!(best.streamUrl || best.previewUrl)}`);
        console.log(`   Note: ${best.note}`);
        
        if (best.matchScore) {
          console.log(`   Match Score: ${best.matchScore}`);
        }
      }
      
      // Show top 3 alternatives
      if (result.alternativeSources.length > 1) {
        console.log(`\n📋 TOP ALTERNATIVES:`);
        result.alternativeSources.slice(0, 3).forEach((source, index) => {
          console.log(`   ${index + 1}. ${source.source} (${source.priorityScore?.toFixed(2)} priority)`);
        });
      }
      
      // Test genre inference as final fallback
      if (!result.hasDirectStream) {
        console.log(`\n🧠 TESTING GENRE INFERENCE FALLBACK:`);
        const genreFeatures = inferAudioFeaturesFromGenres(
          ['house', 'techno', 'electronic'], 
          testCase.artist, 
          testCase.track
        );
        console.log(`   Generated ${Object.keys(genreFeatures).length} audio features`);
        console.log(`   Tempo: ${Math.round(genreFeatures.tempo)} BPM`);
        console.log(`   Energy: ${genreFeatures.energy.toFixed(2)}`);
        console.log(`   Confidence: ${genreFeatures.confidence.toFixed(2)}`);
      }
      
    } catch (error) {
      console.error(`❌ Test failed:`, error.message);
    }
  }
  
  // Test environment variables
  console.log(`\n🔧 ENVIRONMENT CHECK:`);
  console.log(`   Spotify Client ID: ${process.env.SPOTIFY_CLIENT_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`   Spotify Client Secret: ${process.env.SPOTIFY_CLIENT_SECRET ? '✅ Set' : '❌ Missing'}`);
  console.log(`   YouTube API Key: ${process.env.YOUTUBE_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`   SoundCloud Client ID: ${process.env.SOUNDCLOUD_CLIENT_ID ? '✅ Set' : '❌ Missing'}`);
  
  console.log(`\n✅ Enhanced audio sources test completed!`);
}

// Run tests
if (require.main === module) {
  testEnhancedSources().catch(console.error);
}

module.exports = { testEnhancedSources };
