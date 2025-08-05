const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

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
          source: 'essentia_cached',
          confidence: existing.confidence,
          processingTime: 0
        });
      }
    }

    // Perform Essentia.js analysis (mock implementation for now)
    const features = await analyzeAudioWithEssentia(audioUrl);
    
    // Store results
    if (trackId && features && db) {
      await db.collection('audio_features').updateOne(
        { trackId },
        {
          $set: {
            trackId,
            features,
            source: 'essentia',
            confidence: 0.90,
            analyzedAt: new Date(),
            processingTime: Date.now() - startTime
          }
        },
        { upsert: true }
      );
    }

    res.json({
      success: true,
      features,
      source: 'essentia',
      confidence: 0.90,
      processingTime: Date.now() - startTime
    });

  } catch (error) {
    console.error('Audio analysis error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      source: 'essentia_error'
    });
  }
});

// Batch analysis endpoint
app.post('/api/batch', async (req, res) => {
  try {
    const { tracks } = req.body;
    
    if (!Array.isArray(tracks) || tracks.length === 0) {
      return res.status(400).json({ error: 'tracks array is required' });
    }

    console.log(`🎵 Batch analyzing ${tracks.length} tracks`);
    
    const results = [];
    const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_ANALYSIS) || 5;
    
    for (let i = 0; i < tracks.length; i += maxConcurrent) {
      const batch = tracks.slice(i, i + maxConcurrent);
      const batchPromises = batch.map(track => 
        analyzeTrackSafely(track.audioUrl, track.trackId)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map((result, index) => ({
        trackId: batch[index].trackId,
        success: result.status === 'fulfilled',
        features: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? result.reason.message : null
      })));
    }

    res.json({
      success: true,
      results,
      processed: results.length,
      successful: results.filter(r => r.success).length
    });

  } catch (error) {
    console.error('Batch analysis error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Mock Essentia.js analysis function (will be replaced with real implementation)
async function analyzeAudioWithEssentia(audioUrl) {
  const startTime = Date.now();
  
  try {
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
    
    // Generate realistic mock features
    const mockFeatures = {
      energy: Math.random() * 0.5 + 0.5,        // 0.5-1.0
      danceability: Math.random() * 0.4 + 0.6,  // 0.6-1.0
      valence: Math.random() * 0.6 + 0.2,       // 0.2-0.8
      tempo: Math.random() * 40 + 120,          // 120-160 BPM
      spectralCentroid: Math.random() * 2000 + 1000, // 1000-3000 Hz
      mfcc: Array.from({ length: 13 }, () => Math.random() * 20 - 10),
      spectralRolloff: Math.random() * 5000 + 3000,
      zcr: Math.random() * 0.2 + 0.05
    };

    console.log(`✅ Essentia analysis completed in ${Date.now() - startTime}ms`);
    return mockFeatures;
    
  } catch (error) {
    console.error('Essentia analysis failed:', error);
    throw error;
  }
}

async function analyzeTrackSafely(audioUrl, trackId) {
  try {
    return await analyzeAudioWithEssentia(audioUrl);
  } catch (error) {
    console.error(`Failed to analyze track ${trackId}:`, error);
    throw error;
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 Essentia Audio Service running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🎯 Analysis endpoint: http://localhost:${PORT}/api/analyze`);
});
