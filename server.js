const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// MongoDB connection
let db;
MongoClient.connect(MONGODB_URI)
  .then(client => {
    console.log('📊 Connected to MongoDB');
    db = client.db();
  })
  .catch(error => console.error('MongoDB connection error:', error));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'tiko-essentia-audio-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: db ? 'connected' : 'disconnected'
  });
});

// Audio analysis endpoint
app.post('/api/analyze', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { audioUrl, trackId } = req.body;
    
    if (!audioUrl) {
      return res.status(400).json({ error: 'audioUrl is required' });
    }

    console.log(`🎵 Analyzing audio: ${audioUrl.substring(0, 50)}...`);
    
    // Check if already analyzed
    if (trackId && db) {
      const existing = await db.collection('audio_features').findOne({ trackId });
      if (existing && existing.source === 'essentia') {
        console.log(`✅ Using cached Essentia analysis for ${trackId}`);
        return res.json({
          success: true,
          features: existing.features,
          source: 'cache',
          analysisTime: Date.now() - startTime
        });
      }
    }

    // Analyze with Essentia
    const features = await analyzeAudioWithEssentia(audioUrl);
    
    // Store in database if trackId provided
    if (trackId && db) {
      await db.collection('audio_features').updateOne(
        { trackId },
        {
          $set: {
            trackId,
            features,
            source: 'essentia',
            audioUrl,
            analyzedAt: new Date(),
            analysisTime: Date.now() - startTime
          }
        },
        { upsert: true }
      );
    }

    res.json({
      success: true,
      features,
      source: 'essentia',
      analysisTime: Date.now() - startTime
    });

  } catch (error) {
    console.error('❌ Analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message 
    });
  }
});

// Batch analysis endpoint
app.post('/api/batch', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { audioUrls, batchId } = req.body;
    
    if (!audioUrls || !Array.isArray(audioUrls)) {
      return res.status(400).json({ error: 'audioUrls array is required' });
    }

    console.log(`🔄 Batch analyzing ${audioUrls.length} audio files...`);
    
    const results = [];
    
    for (let i = 0; i < audioUrls.length; i++) {
      const audioUrl = audioUrls[i];
      
      try {
        console.log(`   Analyzing ${i+1}/${audioUrls.length}: ${audioUrl.substring(0, 50)}...`);
        const features = await analyzeAudioWithEssentia(audioUrl);
        
        results.push({
          audioUrl,
          features,
          success: true
        });
        
        // Small delay between requests
        if (i < audioUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
      } catch (error) {
        console.warn(`⚠️ Failed to analyze ${audioUrl}:`, error.message);
        results.push({
          audioUrl,
          error: error.message,
          success: false
        });
      }
    }

    res.json({
      success: true,
      results,
      batchId,
      totalProcessed: results.length,
      successful: results.filter(r => r.success).length,
      analysisTime: Date.now() - startTime
    });

  } catch (error) {
    console.error('❌ Batch analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message 
    });
  }
});

// Artist analysis endpoint - STAGED TRACK ANALYSIS WITH ESSENTIA
app.post('/api/analyze-artist', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { 
      artistName, 
      spotifyId, 
      maxTracks = 20, 
      includeRecentReleases = true,
      existingGenres = [], // Existing Spotify genres from database
      spotifyCredentials // New: Accept Spotify credentials from frontend
    } = req.body;
    
    if (!artistName) {
      return res.status(400).json({ error: 'artistName is required' });
    }

    console.log(`🎤 Analyzing artist: ${artistName}`);
    console.log(`📊 Max tracks: ${maxTracks}, Recent releases: ${includeRecentReleases}`);
    
    // Get Spotify access token (use provided credentials or environment variables)
    let spotifyToken;
    if (spotifyCredentials && spotifyCredentials.accessToken) {
      spotifyToken = spotifyCredentials.accessToken;
      console.log('🔑 Using frontend-provided Spotify credentials');
    } else {
      spotifyToken = await getSpotifyToken();
      if (!spotifyToken) {
        console.warn('⚠️ No Spotify credentials available - limited functionality');
        // Continue without Spotify (Apple-only mode)
      }
    }

    let tracks = [];

    // Method 1: Get top tracks using artist ID (if provided and we have Spotify token)
    if (spotifyId && spotifyToken) {
      console.log(`🔍 Fetching top tracks for Spotify ID: ${spotifyId}`);
      
      try {
        const topTracksResponse = await fetch(`https://api.spotify.com/v1/artists/${spotifyId}/top-tracks?market=US`, {
          headers: { 'Authorization': `Bearer ${spotifyToken}` }
        });
        
        if (topTracksResponse.ok) {
          const topTracksData = await topTracksResponse.json();
          tracks = topTracksData.tracks || [];
          console.log(`✅ Found ${tracks.length} top tracks`);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to get top tracks: ${error.message}`);
      }

      // Method 2: Get recent releases (albums from last 2 years)
      if (includeRecentReleases) {
        try {
          const albumsResponse = await fetch(`https://api.spotify.com/v1/artists/${spotifyId}/albums?include_groups=album,single&market=US&limit=50`, {
            headers: { 'Authorization': `Bearer ${spotifyToken}` }
          });
          
          if (albumsResponse.ok) {
            const albumsData = await albumsResponse.json();
            const recentAlbums = albumsData.items?.filter(album => {
              const releaseYear = new Date(album.release_date).getFullYear();
              const currentYear = new Date().getFullYear();
              return currentYear - releaseYear <= 2;
            }) || [];
            
            console.log(`🆕 Found ${recentAlbums.length} recent albums`);
            
            // Get tracks from recent albums
            for (const album of recentAlbums.slice(0, 10)) { // Limit to 10 recent albums
              try {
                const albumTracksResponse = await fetch(`https://api.spotify.com/v1/albums/${album.id}/tracks`, {
                  headers: { 'Authorization': `Bearer ${spotifyToken}` }
                });
                
                if (albumTracksResponse.ok) {
                  const albumTracksData = await albumTracksResponse.json();
                  const albumTracks = albumTracksData.items?.map(track => ({
                    ...track,
                    album: album,
                    isRecentRelease: true
                  })) || [];
                  
                  tracks = tracks.concat(albumTracks);
                }
              } catch (error) {
                console.warn(`⚠️ Failed to get tracks for album ${album.name}:`, error.message);
              }
            }
          }
        } catch (error) {
          console.warn(`⚠️ Failed to get recent albums: ${error.message}`);
        }
      }
    }

    // Fallback: Search for artist if no tracks found and we have Spotify token
    if (tracks.length === 0 && spotifyToken) {
      console.log(`🔍 Fallback: Searching for tracks by artist name`);
      
      try {
        const searchResponse = await fetch(`https://api.spotify.com/v1/search?q=artist:"${encodeURIComponent(artistName)}"&type=track&market=US&limit=20`, {
          headers: { 'Authorization': `Bearer ${spotifyToken}` }
        });
        
        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          tracks = searchData.tracks?.items || [];
          console.log(`🔍 Search fallback found ${tracks.length} tracks`);
        }
      } catch (error) {
        console.warn(`⚠️ Search fallback failed: ${error.message}`);
      }
    }
    
    // Apple-only fallback if no Spotify access
    if (tracks.length === 0 && !spotifyToken) {
      console.log(`🍎 Using Apple-only mode (no Spotify credentials)`);
      tracks = await findAppleTracksForArtist(artistName, 20);
    }

    if (tracks.length === 0) {
      return res.json({
        success: false,
        error: 'No tracks found for artist',
        artistName
      });
    }

    // ===== STAGED TRACK ANALYSIS =====
    // Round 1: 5 top + 5 recent = 10 tracks
    // Round 2: 5 more top + 5 more recent = 10 more tracks (if Round 1 successful)
    // Total Max: 10 top + 10 recent = 20 tracks
    
    const topTracks = tracks.filter(t => !t.isRecentRelease);
    const recentTracks = tracks.filter(t => t.isRecentRelease);
    
    console.log(`🎵 Available: ${topTracks.length} top tracks, ${recentTracks.length} recent releases`);
    
    // Round 1: First 10 tracks (5 top + 5 recent)
    const round1TopTracks = topTracks.slice(0, 5);
    const round1RecentTracks = recentTracks.slice(0, 5);
    const round1Tracks = [...round1TopTracks, ...round1RecentTracks];
    
    console.log(`🔄 Round 1: Analyzing ${round1Tracks.length} tracks (${round1TopTracks.length} top + ${round1RecentTracks.length} recent)`);
    
    const trackProfiles = [];
    const averageFeatures = {};
    const spectralFeatures = {};
    let featureCounts = {};

    // ROUND 1 ANALYSIS
    let round1Success = 0;
    for (let i = 0; i < round1Tracks.length; i++) {
      const track = round1Tracks[i];
      
      try {
        console.log(`   [R1] Track ${i+1}/${round1Tracks.length}: ${track.name}${track.isRecentRelease ? ' (recent)' : ' (top)'}...`);
        
        // Get preview URL (Spotify first, Apple fallback, extended Apple search)
        let previewUrl = track.preview_url;
        if (!previewUrl) {
          previewUrl = await findApplePreviewUrl(track.artists[0].name, track.name);
        }
        // If still no preview, try broader Apple search
        if (!previewUrl) {
          previewUrl = await findApplePreviewUrlBroader(track.artists[0].name, track.name);
        }
        
        if (previewUrl) {
          const features = await analyzeAudioWithEssentia(previewUrl);
          
          trackProfiles.push({
            trackId: track.id,
            name: track.name,
            artist: track.artists[0]?.name,
            popularity: track.popularity,
            isRecentRelease: track.isRecentRelease || false,
            albumInfo: track.album || null,
            previewUrl: previewUrl,
            essentiaFeatures: features,
            analyzedAt: new Date(),
            analysisRound: 1
          });
          
          // Aggregate for backward compatibility
          for (const [key, value] of Object.entries(features)) {
            if (typeof value === 'number' && !isNaN(value)) {
              averageFeatures[key] = (averageFeatures[key] || 0) + value;
              featureCounts[key] = (featureCounts[key] || 0) + 1;
            }
          }
          
          round1Success++;
          console.log(`     ✅ Round 1 analysis complete`);
        } else {
          console.log(`     ⚠️ No preview URL for: ${track.name}`);
        }
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.warn(`⚠️ Round 1 failed to analyze ${track.name}:`, error.message);
      }
    }

    console.log(`📊 Round 1 Results: ${round1Success}/${round1Tracks.length} tracks analyzed successfully`);
    
    // ROUND 2 ANALYSIS (only if Round 1 had reasonable success)
    const round1SuccessRate = round1Success / round1Tracks.length;
    let round2Success = 0;
    let round2Tracks = []; // Initialize empty array
    
    if (round1SuccessRate >= 0.4 && maxTracks > 10) { // At least 40% success rate and maxTracks allows more
      console.log(`🔄 Round 1 success rate: ${(round1SuccessRate * 100).toFixed(1)}% - Starting Round 2`);
      
      // Round 2: Next 10 tracks (5 more top + 5 more recent)
      const round2TopTracks = topTracks.slice(5, 10); // Next 5 top tracks
      const round2RecentTracks = recentTracks.slice(5, 10); // Next 5 recent tracks
      round2Tracks = [...round2TopTracks, ...round2RecentTracks];
      
      console.log(`🔄 Round 2: Analyzing ${round2Tracks.length} more tracks (${round2TopTracks.length} top + ${round2RecentTracks.length} recent)`);
      
      for (let i = 0; i < round2Tracks.length; i++) {
        const track = round2Tracks[i];
        
        try {
          console.log(`   [R2] Track ${i+1}/${round2Tracks.length}: ${track.name}${track.isRecentRelease ? ' (recent)' : ' (top)'}...`);
          
          // Get preview URL (Spotify first, Apple fallback, extended Apple search)
          let previewUrl = track.preview_url;
          if (!previewUrl) {
            previewUrl = await findApplePreviewUrl(track.artists[0].name, track.name);
          }
          // If still no preview, try broader Apple search
          if (!previewUrl) {
            previewUrl = await findApplePreviewUrlBroader(track.artists[0].name, track.name);
          }
          
          if (previewUrl) {
            const features = await analyzeAudioWithEssentia(previewUrl);
            
            trackProfiles.push({
              trackId: track.id,
              name: track.name,
              artist: track.artists[0]?.name,
              popularity: track.popularity,
              isRecentRelease: track.isRecentRelease || false,
              albumInfo: track.album || null,
              previewUrl: previewUrl,
              essentiaFeatures: features,
              analyzedAt: new Date(),
              analysisRound: 2
            });
            
            // Aggregate for backward compatibility
            for (const [key, value] of Object.entries(features)) {
              if (typeof value === 'number' && !isNaN(value)) {
                averageFeatures[key] = (averageFeatures[key] || 0) + value;
                featureCounts[key] = (featureCounts[key] || 0) + 1;
              }
            }
            
            round2Success++;
            console.log(`     ✅ Round 2 analysis complete`);
          } else {
            console.log(`     ⚠️ No preview URL for: ${track.name}`);
          }
          
          // Small delay
          await new Promise(resolve => setTimeout(resolve, 500));
          
        } catch (error) {
          console.warn(`⚠️ Round 2 failed to analyze ${track.name}:`, error.message);
        }
      }
      
      console.log(`📊 Round 2 Results: ${round2Success}/${round2Tracks.length} additional tracks analyzed`);
    } else {
      console.log(`⚠️ Skipping Round 2 - Round 1 success rate too low (${(round1SuccessRate * 100).toFixed(1)}%) or maxTracks limit`);
    }

    const totalSuccess = round1Success + round2Success;
    const totalAttempted = round1Tracks.length + round2Tracks.length;
    
    console.log(`🎯 Final Analysis Results:`);
    console.log(`   Total tracks analyzed: ${totalSuccess}/${totalAttempted}`);
    console.log(`   Top tracks: ${trackProfiles.filter(t => !t.isRecentRelease).length}`);
    console.log(`   Recent releases: ${trackProfiles.filter(t => t.isRecentRelease).length}`);
    console.log(`   Success rate: ${((totalSuccess/totalAttempted)*100).toFixed(1)}%`);

    // Calculate averages for backward compatibility
    for (const [key, total] of Object.entries(averageFeatures)) {
      if (featureCounts[key] > 0) {
        averageFeatures[key] = total / featureCounts[key];
      }
    }

    // Basic spectral features (placeholder for advanced analysis)
    if (trackProfiles.length > 0) {
      spectralFeatures.spectralCentroid = averageFeatures.spectral_centroid || 0;
      spectralFeatures.spectralRolloff = averageFeatures.spectral_rolloff || 0;
      spectralFeatures.mfcc = averageFeatures.mfcc_mean || 0;
    }

    if (trackProfiles.length === 0) {
      return res.json({
        success: false,
        error: 'No tracks could be analyzed with Essentia',
        artistName,
        tracksAttempted: totalAttempted
      });
    }

    // Build genre mapping and sound characteristics
    const genreMapping = await buildGenreMapping(trackProfiles, artistName, existingGenres);
    const recentEvolution = calculateRecentSoundEvolution(trackProfiles);

    const result = {
      success: true,
      artistName,
      spotifyId,
      trackMatrix: trackProfiles, // Individual track analysis (NOT aggregated)
      genreMapping,
      recentEvolution,
      averageFeatures, // For backward compatibility
      spectralFeatures, // For backward compatibility
      metadata: {
        totalTracksAnalyzed: trackProfiles.length,
        topTracks: trackProfiles.filter(t => !t.isRecentRelease).length,
        recentReleases: trackProfiles.filter(t => t.isRecentRelease).length,
        round1Success: round1Success,
        round2Success: round2Success,
        analysisRounds: round2Success > 0 ? 2 : 1,
        successRate: `${((totalSuccess/totalAttempted)*100).toFixed(1)}%`,
        analysisTime: Date.now() - startTime,
        source: 'essentia',
        stagedAnalysis: true
      }
    };

    res.json(result);

  } catch (error) {
    console.error('❌ Artist analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      artistName: req.body.artistName
    });
  }
});

// User sound profile matrix endpoint - build from recent 20 tracks
app.post('/api/user-profile', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { userId, recentTracks, maxTracks = 20 } = req.body;
    
    if (!userId || !recentTracks || !Array.isArray(recentTracks)) {
      return res.status(400).json({ error: 'userId and recentTracks array required' });
    }

    console.log(`👤 Building user sound profile matrix for: ${userId}`);
    console.log(`🎵 Analyzing ${Math.min(recentTracks.length, maxTracks)} recent tracks (up to 20)`);
    
    const userTrackProfiles = [];
    const tracksToAnalyze = recentTracks.slice(0, maxTracks);
    
    for (let i = 0; i < tracksToAnalyze.length; i++) {
      const track = tracksToAnalyze[i];
      
      try {
        console.log(`   Analyzing user track ${i+1}/${tracksToAnalyze.length}: ${track.name}...`);
        
        // Get preview URL (Spotify first, Apple fallback)
        let previewUrl = track.preview_url;
        if (!previewUrl && track.artists && track.name) {
          previewUrl = await findApplePreviewUrl(track.artists[0].name, track.name);
        }
        
        if (previewUrl) {
          const features = await analyzeAudioWithEssentia(previewUrl);
          
          userTrackProfiles.push({
            trackId: track.id,
            name: track.name,
            artist: track.artists[0]?.name,
            essentiaFeatures: features,
            listenedAt: track.listenedAt || new Date(),
            analyzedAt: new Date()
          });
          
          console.log(`     ✅ User track analysis complete`);
        } else {
          console.log(`     ⚠️ No preview URL for user track: ${track.name}`);
        }
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.warn(`⚠️ Failed to analyze user track ${track.name}:`, error.message);
      }
    }

    if (userTrackProfiles.length === 0) {
      return res.json({
        success: false,
        error: 'No user tracks could be analyzed',
        userId
      });
    }

    // Calculate user sound preferences
    const soundPreferences = calculateUserSoundPreferences(userTrackProfiles);
    
    // Store user profile in database
    if (db) {
      await db.collection('user_sound_profiles').updateOne(
        { userId },
        {
          $set: {
            userId,
            trackMatrix: userTrackProfiles, // Individual track matrix
            soundPreferences,
            profileUpdatedAt: new Date(),
            tracksAnalyzed: userTrackProfiles.length,
            source: 'essentia'
          }
        },
        { upsert: true }
      );
    }

    res.json({
      success: true,
      userId,
      trackMatrix: userTrackProfiles, // Individual track analysis
      soundPreferences,
      metadata: {
        tracksAnalyzed: userTrackProfiles.length,
        analysisTime: Date.now() - startTime,
        source: 'essentia'
      }
    });

  } catch (error) {
    console.error('❌ User profile analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      userId: req.body.userId
    });
  }
});

// ===== HELPER FUNCTIONS =====

// Get Spotify access token
async function getSpotifyToken() {
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`
      },
      body: 'grant_type=client_credentials'
    });

    if (response.ok) {
      const data = await response.json();
      return data.access_token;
    }
  } catch (error) {
    console.error('❌ Spotify token error:', error);
  }
  return null;
}

// Find Apple preview URL as fallback
async function findApplePreviewUrl(artistName, trackName) {
  try {
    const searchTerm = `${artistName} ${trackName}`.replace(/[^\w\s]/gi, '');
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=music&entity=song&limit=1`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        return data.results[0].previewUrl;
      }
    }
  } catch (error) {
    console.warn(`⚠️ Apple search failed for ${artistName} - ${trackName}:`, error.message);
  }
  return null;
}

// Find Apple tracks for artist (when no Spotify access)
async function findAppleTracksForArtist(artistName, limit = 20) {
  try {
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&media=music&entity=song&limit=${limit}`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        return data.results.map(result => ({
          id: result.trackId,
          name: result.trackName,
          artists: [{ name: result.artistName }],
          album: { name: result.collectionName },
          popularity: 50, // Default
          preview_url: result.previewUrl,
          external_urls: { itunes: result.trackViewUrl }
        }));
      }
    }
  } catch (error) {
    console.warn(`⚠️ Apple artist search failed for ${artistName}:`, error.message);
  }
  return [];
}

// Broader Apple search (for difficult tracks)
async function findApplePreviewUrlBroader(artistName, trackName) {
  try {
    // Try with just the artist name
    const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&media=music&entity=song&limit=10`);
    
    if (response.ok) {
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        // Return the first result's preview URL
        const firstResult = data.results.find(result => result.previewUrl);
        return firstResult ? firstResult.previewUrl : null;
      }
    }
  } catch (error) {
    console.warn(`⚠️ Broader Apple search failed for ${artistName}:`, error.message);
  }
  return null;
}

// Analyze audio with Essentia (placeholder - replace with actual Essentia.js calls)
async function analyzeAudioWithEssentia(audioUrl) {
  // This is a placeholder - in production, you would use Essentia.js
  // For now, returning mock features that match Essentia's output structure
  
  console.log(`🔬 Essentia analyzing: ${audioUrl.substring(0, 50)}...`);
  
  // Simulate analysis time
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Mock Essentia features (replace with real Essentia.js analysis)
  return {
    // Low-level features
    spectral_centroid: Math.random() * 4000 + 1000,
    spectral_rolloff: Math.random() * 8000 + 2000,
    spectral_flux: Math.random() * 100,
    mfcc_mean: Math.random() * 50 - 25,
    chroma_mean: Math.random(),
    
    // Rhythm features
    tempo: Math.random() * 100 + 80,
    beats_per_minute: Math.random() * 100 + 80,
    rhythm_strength: Math.random(),
    
    // Tonal features
    key_strength: Math.random(),
    harmonicity: Math.random(),
    
    // High-level features
    danceability: Math.random(),
    energy: Math.random(),
    valence: Math.random(),
    arousal: Math.random(),
    
    // Essentia-specific
    loudness: Math.random() * 60 - 60,
    dynamic_range: Math.random() * 20,
    zerocrossingrate: Math.random() * 0.2,
    
    // Analysis metadata
    analysis_source: 'essentia',
    analysis_version: '2.1-beta5'
  };
}

// Calculate user sound preferences from track matrix
function calculateUserSoundPreferences(trackProfiles) {
  if (!trackProfiles || trackProfiles.length === 0) return {};
  
  const preferences = {};
  const features = ['danceability', 'energy', 'valence', 'tempo', 'spectral_centroid'];
  
  features.forEach(feature => {
    const values = trackProfiles
      .map(track => track.essentiaFeatures[feature])
      .filter(val => val !== undefined && !isNaN(val));
    
    if (values.length > 0) {
      const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
      const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
      
      preferences[feature] = {
        average: avg,
        variance: variance,
        range: [Math.min(...values), Math.max(...values)]
      };
    }
  });
  
  return preferences;
}

// Build genre mapping from tracks
async function buildGenreMapping(trackProfiles, artistName, existingGenres = []) {
  // PRIORITY 1: Use existing Spotify genres if available
  if (existingGenres && existingGenres.length > 0) {
    console.log(`🎼 Using existing Spotify genres for ${artistName}: ${existingGenres.join(', ')}`);
    return {
      inferredGenres: existingGenres.slice(0, 5), // Use up to 5 existing genres as array
      source: 'spotify',
      confidence: 1.0
    };
  }
  
  // PRIORITY 2: Infer from audio features
  const genres = inferGenresFromTracks(trackProfiles, artistName);
  const genreProfile = calculateGenreSoundProfile(trackProfiles);
  
  // Return object with inferredGenres array (as expected by frontend)
  if (genres && genres.length > 0) {
    console.log(`🎼 Inferred genres from audio features for ${artistName}: ${genres.join(', ')}`);
    return {
      inferredGenres: genres,
      source: 'audio_analysis',
      confidence: 0.8
    };
  }
  
  // PRIORITY 3: If no genres inferred from audio features, try artist name-based inference
  const artistBasedGenres = inferGenreFromArtistName(artistName);
  if (artistBasedGenres && artistBasedGenres.length > 0) {
    console.log(`🎼 Inferred genres from artist name for ${artistName}: ${artistBasedGenres.join(', ')}`);
    return {
      inferredGenres: artistBasedGenres,
      source: 'name_inference',
      confidence: 0.6
    };
  }
  
  console.log(`⚠️ No genres found for ${artistName}`);
  return {
    inferredGenres: [],
    source: 'none',
    confidence: 0.0
  };
}

// Calculate recent sound evolution
function calculateRecentSoundEvolution(trackProfiles) {
  const recentTracks = trackProfiles.filter(t => t.isRecentRelease);
  const topTracks = trackProfiles.filter(t => !t.isRecentRelease);
  
  if (recentTracks.length === 0 || topTracks.length === 0) {
    return { evolution: 'insufficient_data' };
  }
  
  const recentAvg = calculateAverageFeatures(recentTracks);
  const topAvg = calculateAverageFeatures(topTracks);
  
  return {
    evolution: 'detected',
    energyChange: recentAvg.energy - topAvg.energy,
    danceabilityChange: recentAvg.danceability - topAvg.danceability,
    valenceChange: recentAvg.valence - topAvg.valence,
    tempoChange: recentAvg.tempo - topAvg.tempo,
    recentTracksCount: recentTracks.length,
    topTracksCount: topTracks.length
  };
}

// Calculate average features from track profiles
function calculateAverageFeatures(trackProfiles) {
  if (!trackProfiles || trackProfiles.length === 0) return {};
  
  const features = ['energy', 'danceability', 'valence', 'tempo', 'spectral_centroid'];
  const averages = {};
  
  features.forEach(feature => {
    const values = trackProfiles
      .map(track => track.essentiaFeatures[feature])
      .filter(val => val !== undefined && !isNaN(val));
    
    if (values.length > 0) {
      averages[feature] = values.reduce((sum, val) => sum + val, 0) / values.length;
    }
  });
  
  return averages;
}

// Infer genres from track characteristics
function inferGenresFromTracks(trackProfiles, artistName) {
  if (!trackProfiles || trackProfiles.length === 0) return [];
  
  const genres = [];
  const avgFeatures = calculateAverageFeatures(trackProfiles);
  
  // Only proceed if we have meaningful features
  if (!avgFeatures.energy && !avgFeatures.tempo && !avgFeatures.danceability) {
    return [];
  }
  
  // EDM/Electronic genre detection (prioritized)
  if (avgFeatures.energy > 0.75 && avgFeatures.tempo > 125 && avgFeatures.danceability > 0.65) {
    genres.push('edm', 'electronic', 'dance');
  } else if (avgFeatures.energy > 0.7 && avgFeatures.tempo > 120) {
    genres.push('electronic', 'dance');
  }
  
  // House/Techno
  if (avgFeatures.tempo > 115 && avgFeatures.tempo < 135 && avgFeatures.danceability > 0.7) {
    genres.push('house', 'techno');
  }
  
  // Trance
  if (avgFeatures.tempo > 130 && avgFeatures.energy > 0.8 && avgFeatures.valence > 0.6) {
    genres.push('trance');
  }
  
  // Dubstep/Bass
  if (avgFeatures.energy > 0.8 && avgFeatures.tempo > 140) {
    genres.push('dubstep', 'bass');
  }
  
  // Pop/Dance-Pop
  if (avgFeatures.energy > 0.6 && avgFeatures.danceability > 0.7 && avgFeatures.valence > 0.5) {
    genres.push('pop', 'dance-pop');
  }
  
  // Alternative/Indie
  if (avgFeatures.valence < 0.4 && avgFeatures.energy < 0.6) {
    genres.push('indie', 'alternative');
  }
  
  // Ambient/Downtempo
  if (avgFeatures.tempo < 100 && avgFeatures.energy < 0.4) {
    genres.push('ambient', 'downtempo');
  }
  
  // Hip-hop/Rap
  if (avgFeatures.tempo > 80 && avgFeatures.tempo < 110 && avgFeatures.energy > 0.6) {
    genres.push('hip-hop', 'rap');
  }
  
  return [...new Set(genres)].slice(0, 3);
}

// Infer genre from artist name (fallback method)
function inferGenreFromArtistName(artistName) {
  const name = artistName.toLowerCase();
  
  // EDM artists (prioritized)
  const edmArtists = ['deadmau5', 'skrillex', 'calvin harris', 'tiesto', 'david guetta', 'armin van buuren', 
                      'martin garrix', 'diplo', 'zedd', 'marshmello', 'fisher', 'ferry corsten', 'dvbbs', 
                      'rezz', 'porter robinson', 'richie hawtin', 'tiga', 'above & beyond', 'eric prydz',
                      'deadmau5', 'swedish house mafia', 'axwell', 'steve angello', 'sebastian ingrosso'];
  
  if (edmArtists.some(artist => name.includes(artist))) {
    return ['edm', 'electronic', 'dance'];
  }
  
  // Rock/Metal
  const rockArtists = ['metallica', 'iron maiden', 'black sabbath', 'suffocation', 'killswitch engage', 
                       'parkway drive', 'beartooth', 'anvil'];
  if (rockArtists.some(artist => name.includes(artist))) {
    return ['rock', 'metal'];
  }
  
  // Hip-hop
  const hipHopArtists = ['wu-tang clan', 'run the jewels', 'big sean', 'russ'];
  if (hipHopArtists.some(artist => name.includes(artist))) {
    return ['hip-hop', 'rap'];
  }
  
  // Pop
  const popArtists = ['coldplay', 'shania twain', 'luke bryan', 'thomas rhett'];
  if (popArtists.some(artist => name.includes(artist))) {
    return ['pop'];
  }
  
  // Alternative/Indie
  const indieArtists = ['pup', 'jeff rosenstock', 'kurt vile', 'tripping daisy', 'mest'];
  if (indieArtists.some(artist => name.includes(artist))) {
    return ['indie', 'alternative'];
  }
  
  return [];
}

// Calculate genre sound profile
function calculateGenreSoundProfile(trackProfiles) {
  const avgFeatures = calculateAverageFeatures(trackProfiles);
  
  return {
    energy_level: avgFeatures.energy > 0.7 ? 'high' : avgFeatures.energy > 0.4 ? 'medium' : 'low',
    danceability_level: avgFeatures.danceability > 0.7 ? 'high' : avgFeatures.danceability > 0.4 ? 'medium' : 'low',
    tempo_range: avgFeatures.tempo > 130 ? 'fast' : avgFeatures.tempo > 100 ? 'medium' : 'slow',
    mood: avgFeatures.valence > 0.6 ? 'positive' : avgFeatures.valence > 0.4 ? 'neutral' : 'melancholic'
  };
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 Essentia Audio Service running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🎯 Analysis endpoint: http://localhost:${PORT}/api/analyze`);
  console.log(`🎤 Artist analysis: http://localhost:${PORT}/api/analyze-artist`);
  console.log(`👤 User profile: http://localhost:${PORT}/api/user-profile`);
});
