

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let db;
let decisionsCollection;
let overrideLogsCollection;
let metricsCollection;

const mongoClient = new MongoClient(process.env.MONGODB_URI);

async function connectDB() {
  try {
    await mongoClient.connect();
    console.log('✅ Connected to MongoDB');
    
    db = mongoClient.db(process.env.DB_NAME);
    decisionsCollection = db.collection('decisions');
    overrideLogsCollection = db.collection('override_logs');
    metricsCollection = db.collection('metrics');
    
    await decisionsCollection.createIndex({ timestamp: -1 });
    await decisionsCollection.createIndex({ "scenario.priorityPattern": 1 });
    await decisionsCollection.createIndex({ learningEnabled: 1 });
    await overrideLogsCollection.createIndex({ timestamp: -1 });
    
    console.log('✅ Database indexes created');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

app.get('/api/decisions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    
    const decisions = await decisionsCollection
      .find({})
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
    
    const total = await decisionsCollection.countDocuments();
    
    res.json({
      success: true,
      data: decisions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching decisions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/decisions/similar', async (req, res) => {
  try {
    const { priorityPattern, conflict } = req.query;
    
    const decisions = await decisionsCollection
      .find({
        learningEnabled: true,
        overridden: false,
        'scenario.priorityPattern': priorityPattern,
        'scenario.conflict': conflict === 'true'
      })
      .sort({ timestamp: -1 })
      .toArray();
    
    res.json({ success: true, data: decisions });
  } catch (error) {
    console.error('Error fetching similar decisions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/decisions', async (req, res) => {
  try {
    const decision = {
      ...req.body,
      timestamp: new Date().toISOString(),
      createdAt: new Date()
    };
    
    const result = await decisionsCollection.insertOne(decision);
    
    res.json({ 
      success: true, 
      data: { ...decision, _id: result.insertedId }
    });
  } catch (error) {
    console.error('Error creating decision:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/decisions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const result = await decisionsCollection.updateOne(
      { decision_id: id },
      { $set: { ...updates, updatedAt: new Date() } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: 'Decision not found' });
    }
    
    res.json({ success: true, data: updates });
  } catch (error) {
    console.error('Error updating decision:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/override-logs', async (req, res) => {
  try {
    const logs = await overrideLogsCollection
      .find({})
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();
    
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Error fetching override logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/override-logs', async (req, res) => {
  try {
    const log = {
      ...req.body,
      timestamp: new Date().toISOString(),
      createdAt: new Date()
    };
    
    const result = await overrideLogsCollection.insertOne(log);
    
    res.json({ 
      success: true, 
      data: { ...log, _id: result.insertedId }
    });
  } catch (error) {
    console.error('Error creating override log:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/metrics', async (req, res) => {
  try {
    let metrics = await metricsCollection.findOne({ type: 'current' });
    
    if (!metrics) {
      metrics = {
        type: 'current',
        aiSuggestions: 0,
        humanApprovals: 0,
        overrides: 0,
        conflicts: 0,
        greenCorridors: 0,
        totalDecisions: 0,
        updatedAt: new Date()
      };
      await metricsCollection.insertOne(metrics);
    }
    
    res.json({ success: true, data: metrics });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/metrics', async (req, res) => {
  try {
    const updates = req.body;
    
    const result = await metricsCollection.updateOne(
      { type: 'current' },
      { 
        $set: { ...updates, updatedAt: new Date() },
        $setOnInsert: { type: 'current' }
      },
      { upsert: true }
    );
    
    res.json({ success: true, data: updates });
  } catch (error) {
    console.error('Error updating metrics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/analytics/stats', async (req, res) => {
  try {
    const totalDecisions = await decisionsCollection.countDocuments();
    const approvedDecisions = await decisionsCollection.countDocuments({ approved: true });
    const overriddenDecisions = await decisionsCollection.countDocuments({ overridden: true });
    const learningDecisions = await decisionsCollection.countDocuments({ learningEnabled: true });
    const conflictDecisions = await decisionsCollection.countDocuments({ 'scenario.conflict': true });
    
    const priorityPatterns = await decisionsCollection.aggregate([
      { $group: { _id: '$scenario.priorityPattern', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    res.json({
      success: true,
      data: {
        totalDecisions,
        approvedDecisions,
        overriddenDecisions,
        learningDecisions,
        conflictDecisions,
        priorityPatterns
      }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API available at http://localhost:${PORT}/api`);
  });
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await mongoClient.close();
  process.exit(0);
});
