#!/usr/bin/env node
/**
 * ESSENTIA-BASED AUDIO PROFILE MATRIX BUILDER
 * Uses the deployed Essentia service to build comprehensive audio profiles
 * This replaces deprecated Spotify audio features with advanced ML analysis
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

// Essentia service configuration
const ESSENTIA_SERVICE_URL = process.env.ESSENTIA_SERVICE_URL || 'https://tiko-essentia-audio-service-2eff1b2af167.herokuapp.com';
// Alternative: 'http://localhost:3001' for local development

async function buildEssentiaAudioProfileMatrix() {
  console.log('🎵 BUILDING ESSENTIA-BASED AUDIO PROFILE MATRIX');
  console.log('===============================================');
  
  const fetch = (await import('node-fetch')).default;
  
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/sonaredm');
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'sonaredm');
  const artistGenresCollection = db.collection('artistGenres');
  
  // Verify Essentia service is available
  try {
    const healthCheck = await fetch(`${ESSENTIA_SERVICE_URL}/health`);
    if (!healthCheck.ok) {
      throw new Error(`Essentia service health check failed: ${healthCheck.status}`);
    }
    console.log('✅ Essentia service is online and ready');
  } catch (error) {
    console.error('❌ Essentia service unavailable:', error.message);
    process.exit(1);
  }
  
  // Get all artists without Essentia audio profiles
  const artistsToProcess = await artistGenresCollection.find({
    essentiaAudioProfile: { $exists: false }
  }).toArray();
  
  console.log(`\n📊 Artists to process: ${artistsToProcess.length}`);
  
  let processed = 0;
  let successful = 0;
  let failed = 0;
  
  for (const artist of artistsToProcess) {
    try {
      console.log(`\n[${processed + 1}/${artistsToProcess.length}] Processing: ${artist.originalName}`);
      
      // Build Essentia-based audio profile
      const audioProfile = await buildEssentiaArtistProfile(artist);
      
      if (audioProfile.success) {
        // Update artist in database with NEW STAGED ANALYSIS FORMAT
        await artistGenresCollection.updateOne(
          { _id: artist._id },
          { 
            $set: { 
              // NEW FORMAT: Store track matrix (not aggregated profile)
              essentiaTrackMatrix: audioProfile.trackMatrix,
              essentiaGenreMapping: audioProfile.genreMapping,
              essentiaRecentEvolution: audioProfile.recentEvolution,
              
              // Backward compatibility fields
              essentiaAudioProfile: {
                averageFeatures: audioProfile.averageFeatures,
                spectralFeatures: audioProfile.spectralFeatures,
                tracks: audioProfile.trackMatrix,
                metadata: audioProfile.metadata
              },
              
              // Status fields
              essentiaProfileBuilt: true,
              essentiaProfileDate: new Date(),
              essentiaVersion: '2.0-staged',
              stagingAnalysis: true
            }
          }
        );
        
        successful++;
        console.log(`   ✅ Staged Essentia analysis complete:`);
        console.log(`      📊 Tracks in matrix: ${audioProfile.trackMatrix?.length || 0}`);
        console.log(`      🔄 Analysis rounds: ${audioProfile.metadata?.analysisRounds || 1}`);
        console.log(`      � Success rate: ${audioProfile.metadata?.successRate || 'N/A'}`);
        console.log(`      🎧 Top tracks: ${audioProfile.metadata?.topTracks || 0}`);
        console.log(`      🆕 Recent releases: ${audioProfile.metadata?.recentReleases || 0}`);
        console.log(`      🎼 Genre mapping: ${audioProfile.genreMapping?.inferredGenres?.join(', ') || 'N/A'}`);
      } else {
        failed++;
        console.log(`   ❌ Failed: ${audioProfile.error}`);
      }
      
    } catch (error) {
      console.error(`❌ Error processing ${artist.originalName}:`, error.message);
      failed++;
    }
    
    processed++;
    
    // Progress update every 5 artists (Essentia is slower than Spotify)
    if (processed % 5 === 0) {
      console.log(`\n📈 PROGRESS: ${processed}/${artistsToProcess.length}`);
      console.log(`   Successful: ${successful}`);
      console.log(`   Failed: ${failed}`);
      console.log(`   Success rate: ${((successful/processed)*100).toFixed(1)}%`);
    }
    
    // Rate limiting - Essentia analysis is resource intensive
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
  }
  
  console.log(`\n✅ ESSENTIA AUDIO PROFILE MATRIX COMPLETE:`);
  console.log(`   Artists processed: ${processed}`);
  console.log(`   Successful profiles: ${successful}`);
  console.log(`   Failed profiles: ${failed}`);
  console.log(`   Success rate: ${((successful/processed)*100).toFixed(1)}%`);
  
  // Verify the results
  const artistsWithEssentiaProfiles = await artistGenresCollection.countDocuments({
    essentiaAudioProfile: { $exists: true }
  });
  
  const totalArtists = await artistGenresCollection.countDocuments();
  
  console.log(`\n📊 FINAL STATUS:`);
  console.log(`   Artists with Essentia profiles: ${artistsWithEssentiaProfiles}/${totalArtists}`);
  console.log(`   Coverage: ${((artistsWithEssentiaProfiles/totalArtists)*100).toFixed(1)}%`);
  
  await client.close();
}

/**
 * Build comprehensive Essentia-based audio profile for a single artist
 * WITH STAGED TRACK ANALYSIS (5+5, then 5+5 more if successful)
 */
async function buildEssentiaArtistProfile(artist) {
  try {
    const fetch = (await import('node-fetch')).default;
    
    console.log(`   🎤 Using Essentia staged analysis for: ${artist.originalName}`);
    
    // Call Essentia service artist endpoint with staged analysis
    const response = await fetch(`${ESSENTIA_SERVICE_URL}/api/analyze-artist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        artistName: artist.originalName,
        spotifyId: artist.spotifyId,
        maxTracks: 20, // Staged: Round 1 (10 tracks), Round 2 (10 more tracks)
        includeRecentReleases: true
      }),
      timeout: 180000 // 3 minute timeout for staged analysis
    });
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }
    
    const analysisResult = await response.json();
    
    if (analysisResult.success) {
      return {
        success: true,
        trackMatrix: analysisResult.trackMatrix, // Individual track profiles
        genreMapping: analysisResult.genreMapping,
        recentEvolution: analysisResult.recentEvolution,
        averageFeatures: analysisResult.averageFeatures, // Backward compatibility
        spectralFeatures: analysisResult.spectralFeatures, // Backward compatibility
        metadata: analysisResult.metadata
      };
    } else {
      return { success: false, error: analysisResult.error || 'Staged artist analysis failed' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Run the builder
if (require.main === module) {
  buildEssentiaAudioProfileMatrix().catch(console.error);
}

module.exports = { buildEssentiaAudioProfileMatrix };
