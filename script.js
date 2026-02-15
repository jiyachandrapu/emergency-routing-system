

import {
  recordDecision,
  findSimilarDecisionsByScenario,
  decisionMemory,
  saveMemoryToLocalStorage,
  loadMemoryFromLocalStorage
} from "./decisionMemory.js";

loadMemoryFromLocalStorage();

const API_BASE_URL = 'http://localhost:3000/api';

let metrics = {
  aiSuggestions: 0,
  humanApprovals: 0,
  overrides: 0,
  conflicts: 0,
  greenCorridors: 0,
  totalDecisions: 0
};

let overrideLogs = [];
let currentRecommendation = null;

function updateMetrics() {
  document.getElementById("aiSuggestions").textContent = metrics.aiSuggestions;
  document.getElementById("humanApprovals").textContent = metrics.humanApprovals;
  document.getElementById("overrides").textContent = metrics.overrides;
  document.getElementById("conflicts").textContent = metrics.conflicts;
  document.getElementById("greenCorridors").textContent = metrics.greenCorridors;
  document.getElementById("totalDecisions").textContent = metrics.totalDecisions;
}

async function apiRequest(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'API request failed');
    }
    
    return data;
  } catch (error) {
    console.error('API Error:', error);
    showMessage(`❌ ${error.message}`, 5000);
    throw error;
  }
}

async function saveDecisionToMongoDB(decision) {
  try {
    const result = await apiRequest('/decisions', {
      method: 'POST',
      body: JSON.stringify(decision)
    });
    
    console.log('✅ Decision saved to MongoDB:', result.data);
    logProcess("💾", `Decision saved to database: ${decision.decision_id}`);
    return result.data;
  } catch (error) {
    logProcess("❌", `Failed to save decision to database: ${error.message}`);
  }
}

async function saveOverrideLogToMongoDB(log) {
  try {
    const result = await apiRequest('/override-logs', {
      method: 'POST',
      body: JSON.stringify(log)
    });
    
    console.log('✅ Override log saved to MongoDB:', result.data);
    return result.data;
  } catch (error) {
    console.error('Failed to save override log:', error);
  }
}

async function updateMetricsInMongoDB(metrics) {
  try {
    const result = await apiRequest('/metrics', {
      method: 'PUT',
      body: JSON.stringify(metrics)
    });
    
    console.log('✅ Metrics updated in MongoDB');
    return result.data;
  } catch (error) {
    console.error('Failed to update metrics:', error);
  }
}

async function getSimilarDecisionsFromMongoDB(scenario) {
  try {
    const result = await apiRequest(
      `/decisions/similar?priorityPattern=${scenario.priorityPattern}&conflict=${scenario.conflict}`
    );
    
    console.log('✅ Similar decisions fetched from MongoDB:', result.data.length);
    return result.data;
  } catch (error) {
    console.error('Failed to fetch similar decisions:', error);
    return [];
  }
}

async function loadHistoricalData(page = 1, limit = 20) {
  try {
    const result = await apiRequest(`/decisions?page=${page}&limit=${limit}`);
    return result;
  } catch (error) {
    console.error('Failed to load historical data:', error);
    return { data: [], pagination: {} };
  }
}

async function loadAnalytics() {
  try {
    const result = await apiRequest('/analytics/stats');
    return result.data;
  } catch (error) {
    console.error('Failed to load analytics:', error);
    return null;
  }
}

let currentHistoryTab = 'decisions';

window.showHistoryTab = function(tab) {
  currentHistoryTab = tab;
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  if (tab === 'decisions') {
    refreshHistoricalData();
  } else if (tab === 'analytics') {
    loadAndDisplayAnalytics();
  }
};

window.refreshHistoricalData = async function() {
  const container = document.getElementById('historicalData');
  
  if (currentHistoryTab === 'decisions') {
    container.innerHTML = '<div class="loading-spinner"></div>';
    
    const result = await loadHistoricalData(1, 20);
    
    if (result.data.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📚</div>
          <div class="empty-state-text">No historical data found in database</div>
        </div>
      `;
      return;
    }
    
    container.innerHTML = '';
    
    result.data.forEach(decision => {
      const card = document.createElement('div');
      card.className = 'history-card';
      
      const statusBadge = decision.approved 
        ? '<span class="history-badge badge-approved">Approved</span>'
        : decision.overridden 
        ? '<span class="history-badge badge-overridden">Overridden</span>'
        : '';
      
      const conflictBadge = decision.scenario?.conflict 
        ? '<span class="history-badge badge-conflict">Conflict</span>'
        : '';
      
      card.innerHTML = `
        <div class="history-header">
          <span>${decision.finalDecision}</span>
          <span style="font-size: 10px; color: #999;">${decision.decision_id}</span>
        </div>
        <div class="history-meta">
          <div><strong>Pattern:</strong> ${decision.scenario?.priorityPattern || 'N/A'} ${conflictBadge}</div>
          <div><strong>Reasoning:</strong> ${decision.reasoning}</div>
          <div><strong>Outcome:</strong> ${decision.outcome}</div>
          <div><strong>Date:</strong> ${new Date(decision.timestamp).toLocaleString()} ${statusBadge}</div>
        </div>
      `;
      
      container.appendChild(card);
    });
    
    if (result.pagination) {
      const pagination = document.createElement('div');
      pagination.style.textAlign = 'center';
      pagination.style.marginTop = '16px';
      pagination.style.fontSize = '12px';
      pagination.style.color = '#666';
      pagination.innerHTML = `
        Showing ${result.data.length} of ${result.pagination.total} decisions
        (Page ${result.pagination.page} of ${result.pagination.pages})
      `;
      container.appendChild(pagination);
    }
    
    logProcess("📚", `Loaded ${result.data.length} historical decisions from database`);
  }
};

async function loadAndDisplayAnalytics() {
  const container = document.getElementById('historicalData');
  container.innerHTML = '<div class="loading-spinner"></div>';
  
  const analytics = await loadAnalytics();
  
  if (!analytics) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <div class="empty-state-text">Analytics data not available</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div class="analytics-grid">
      <div class="analytics-card">
        <div class="analytics-value">${analytics.totalDecisions}</div>
        <div class="analytics-label">Total Decisions</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-value">${analytics.approvedDecisions}</div>
        <div class="analytics-label">Approved</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-value">${analytics.overriddenDecisions}</div>
        <div class="analytics-label">Overridden</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-value">${analytics.learningDecisions}</div>
        <div class="analytics-label">Learning Enabled</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-value">${analytics.conflictDecisions}</div>
        <div class="analytics-label">Conflicts</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-value">${analytics.priorityPatterns?.length || 0}</div>
        <div class="analytics-label">Pattern Types</div>
      </div>
    </div>
  `;
  
  logProcess("📊", "Analytics loaded from database");
}

const map = L.map("map").setView([17.385, 78.4867], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap"
}).addTo(map);

let messageTimeout = null;
function showMessage(text, duration = 3000) {
  const box = document.getElementById("messageBox");
  box.innerText = text;
  box.style.display = "block";
  if (messageTimeout) clearTimeout(messageTimeout);
  messageTimeout = setTimeout(() => box.style.display = "none", duration);
}

function logProcess(icon, text) {
  const container = document.getElementById("processLog");
  if (!container) return;

  const entry = document.createElement("div");
  entry.className = "process-entry";
  
  entry.innerHTML = `
    <span class="process-icon">${icon}</span>
    <span>${text}</span>
    <span class="process-time">${new Date().toLocaleTimeString()}</span>
  `;
  
  container.insertBefore(entry, container.firstChild);
  
  while (container.children.length > 20) {
    container.removeChild(container.lastChild);
  }
}

let selectionMode = null;
const ambulanceA = { 
  start: null, 
  end: null, 
  route: [], 
  marker: null, 
  line: null, 
  timer: null,
  startMarker: null,
  endMarker: null
};
const ambulanceB = { 
  start: null, 
  end: null, 
  route: [], 
  marker: null, 
  line: null, 
  timer: null,
  startMarker: null,
  endMarker: null
};

window.selectAmbulancePoints = function(ambulance, type) {
  selectionMode = { ambulance, type };
  showMessage(`Click on the map to select ${type} location for Ambulance ${ambulance}`);
  logProcess("📍", `Selection mode activated: Ambulance ${ambulance} - ${type} point`);
  map.getContainer().style.cursor = 'crosshair';
};

map.on('click', function(e) {
  if (!selectionMode) return;
  
  const { ambulance, type } = selectionMode;
  const amb = ambulance === 'A' ? ambulanceA : ambulanceB;
  const coords = e.latlng;
  
  if (type === 'start') {
    amb.start = coords;
    
    if (amb.startMarker) {
      map.removeLayer(amb.startMarker);
    }
    
    amb.startMarker = L.marker(coords, {
      icon: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      })
    }).addTo(map).bindPopup(`Ambulance ${ambulance} Start`).openPopup();
    
    if (!amb.marker) {
      amb.marker = L.marker(coords, { 
        icon: L.divIcon({
          html: `<div style='font-size:44px'>🚑</div>`,
          iconSize: [44, 44],
          className: ''
        })
      }).addTo(map);
    } else {
      amb.marker.setLatLng(coords);
    }
    
    document.getElementById(`start${ambulance}`).value = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    logProcess("✓", `Ambulance ${ambulance} start location set: [${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}]`);
    
  } else if (type === 'end') {
    amb.end = coords;
    
    if (amb.endMarker) {
      map.removeLayer(amb.endMarker);
    }
    
    amb.endMarker = L.marker(coords, {
      icon: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      })
    }).addTo(map).bindPopup(`Ambulance ${ambulance} Destination`).openPopup();
    
    document.getElementById(`end${ambulance}`).value = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    logProcess("✓", `Ambulance ${ambulance} destination set: [${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}]`);
  }
  
  selectionMode = null;
  map.getContainer().style.cursor = '';
  showMessage(`✓ Location set for Ambulance ${ambulance}`);
});

function renderAIRecommendation(recommendation) {
  const container = document.getElementById("aiRecommendation");
  
  currentRecommendation = recommendation;
  
  container.innerHTML = `
    <div class="recommendation-card">
      <div class="recommendation-header">
        <span>🤖</span>
        <span>AI Recommendation</span>
      </div>
      <div class="recommendation-content">
        <strong>Decision:</strong> ${recommendation.decision}
      </div>
      <div class="reasoning-section">
        <div class="reasoning-title">🧠 AI Reasoning Process:</div>
        <ul class="reasoning-list">
          ${recommendation.reasoning.map(r => `<li>${r}</li>`).join('')}
        </ul>
      </div>
      <div class="recommendation-content" style="margin-top: 12px;">
        <strong>Confidence Level:</strong> ${recommendation.confidence}%
      </div>
      <div class="recommendation-actions">
        <button class="btn-approve-rec" onclick="approveRecommendation()">
          ✓ Approve AI Decision
        </button>
        <button class="btn-override-rec" onclick="overrideRecommendation()">
          ✗ Override Suggestion
        </button>
      </div>
      <div id="recStatus"></div>
    </div>
  `;
  
  metrics.aiSuggestions++;
  updateMetrics();
  updateMetricsInMongoDB(metrics);
  logProcess("🤖", "AI recommendation generated");
}

window.approveRecommendation = function() {
  if (!currentRecommendation) return;
  
  metrics.humanApprovals++;
  updateMetrics();
  updateMetricsInMongoDB(metrics);
  
  document.getElementById("recStatus").innerHTML = `
    <div class="rec-status status-approved">
      ✓ Human Approved - Decision accepted and recorded in memory
    </div>
  `;
  
  currentRecommendation.approved = true;
  currentRecommendation.learningEnabled = true;
  
  showMessage("✅ AI recommendation approved by human operator");
  logProcess("✓", "AI recommendation approved by human");
  saveMemoryToLocalStorage();
};

window.overrideRecommendation = function() {
  if (!currentRecommendation) return;
  
  const reason = prompt("Please provide reason for overriding AI recommendation:");
  if (!reason) return;
  
  metrics.overrides++;
  updateMetrics();
  updateMetricsInMongoDB(metrics);
  
  document.getElementById("recStatus").innerHTML = `
    <div class="rec-status status-overridden">
      ✗ Human Override - Reason: ${reason}
    </div>
  `;
  
  currentRecommendation.overridden = true;
  currentRecommendation.learningEnabled = false;
  currentRecommendation.overrideReason = reason;
  
  const log = {
    decision: currentRecommendation.decision,
    reason: reason,
    timestamp: new Date().toISOString(),
    type: "AI Recommendation Override"
  };
  
  overrideLogs.push(log);
  saveOverrideLogToMongoDB(log);
  
  updateOverrideLogs();
  showMessage("⚠️ AI recommendation overridden - excluded from learning");
  logProcess("⚠️", `AI recommendation overridden: ${reason}`);
  saveMemoryToLocalStorage();
};

function renderDecisionMemory(decision, similarDecisions = []) {
  const container = document.getElementById("decisionMemoryList");
  
  const card = document.createElement("div");
  card.className = "decision-memory-card";
  card.id = `decision-${decision.decision_id}`;
  
  const hasRecall = similarDecisions.length > 0;
  
  card.innerHTML = `
    <div class="memory-header">
      <div class="memory-title">${decision.finalDecision}</div>
      <div class="memory-id">${decision.decision_id}</div>
    </div>
    <div class="memory-content">
      <div><strong>Intent:</strong> ${decision.intent}</div>
      <div><strong>Constraints:</strong> ${decision.constraints.join(', ')}</div>
      <div><strong>Reasoning:</strong> ${decision.reasoning}</div>
      <div><strong>Outcome:</strong> ${decision.outcome}</div>
    </div>
    ${hasRecall ? `
      <div class="ai-recall-section">
        <div class="recall-header">🧠 AI Recall: ${similarDecisions.length} Similar Past Decision(s) Found</div>
        <div class="recall-content">
          The AI system found ${similarDecisions.length} similar decision(s) from past experiences that match this scenario.
        </div>
        <button class="btn-view-recall" onclick="viewRecalledDecisions('${decision.decision_id}')">
          View Recalled Memories
        </button>
      </div>
    ` : ''}
    <div class="memory-timestamp">
      ${new Date(decision.timestamp).toLocaleString()}
    </div>
    <div class="memory-actions">
      <button class="btn-approve" onclick="approveDecision('${decision.decision_id}')">
        ✓ Approve
      </button>
      <button class="btn-override" onclick="overrideDecision('${decision.decision_id}')">
        ✗ Override
      </button>
    </div>
    <div id="status-${decision.decision_id}"></div>
  `;
  
  container.insertBefore(card, container.firstChild);
  
  metrics.totalDecisions++;
  updateMetrics();
  updateMetricsInMongoDB(metrics);
  
  decision.similarDecisions = similarDecisions;
  
  saveDecisionToMongoDB(decision);
  
  logProcess("🧠", `Decision recorded in memory: ${decision.decision_id}`);
}

window.viewRecalledDecisions = function(decisionId) {
  const decision = decisionMemory.find(d => d.decision_id === decisionId);
  if (!decision || !decision.similarDecisions) return;
  
  const similar = decision.similarDecisions;
  
  let message = `AI RECALLED ${similar.length} SIMILAR PAST DECISION(S):\n\n`;
  
  similar.forEach((d, index) => {
    message += `━━━ Decision ${index + 1} ━━━\n`;
    message += `ID: ${d.decision_id}\n`;
    message += `Decision: ${d.finalDecision}\n`;
    message += `Reasoning: ${d.reasoning}\n`;
    message += `Outcome: ${d.outcome}\n`;
    message += `Date: ${new Date(d.timestamp).toLocaleString()}\n\n`;
  });
  
  alert(message);
  showMessage(`Showing ${similar.length} recalled decision(s)`);
  logProcess("👁️", `Viewed ${similar.length} recalled decisions`);
};

window.approveDecision = async function(decisionId) {
  const decision = decisionMemory.find(d => d.decision_id === decisionId);
  if (!decision) return;
  
  decision.approved = true;
  decision.learningEnabled = true;
  
  metrics.humanApprovals++;
  updateMetrics();
  updateMetricsInMongoDB(metrics);
  
  await apiRequest(`/decisions/${decisionId}`, {
    method: 'PUT',
    body: JSON.stringify({
      approved: true,
      learningEnabled: true
    })
  });
  
  const statusDiv = document.getElementById(`status-${decisionId}`);
  statusDiv.innerHTML = `
    <div class="memory-status status-approved">
      ✓ Approved by Human - Added to AI Learning Memory
    </div>
  `;
  
  const card = document.getElementById(`decision-${decisionId}`);
  card.style.borderLeftColor = "#38ef7d";
  
  showMessage("✅ Decision approved and added to AI learning memory");
  logProcess("✓", `Decision ${decisionId} approved for AI learning`);
  saveMemoryToLocalStorage();
};

window.overrideDecision = async function(decisionId) {
  const decision = decisionMemory.find(d => d.decision_id === decisionId);
  if (!decision) return;
  
  const reason = prompt("Please provide detailed reason for override:");
  if (!reason) return;
  
  decision.overridden = true;
  decision.learningEnabled = false;
  decision.overrideReason = reason;
  
  metrics.overrides++;
  updateMetrics();
  updateMetricsInMongoDB(metrics);
  
  await apiRequest(`/decisions/${decisionId}`, {
    method: 'PUT',
    body: JSON.stringify({
      overridden: true,
      learningEnabled: false,
      overrideReason: reason
    })
  });
  
  const statusDiv = document.getElementById(`status-${decisionId}`);
  statusDiv.innerHTML = `
    <div class="memory-status status-overridden">
      ✗ Overridden by Human - Excluded from AI Learning
    </div>
  `;
  
  const card = document.getElementById(`decision-${decisionId}`);
  card.style.borderLeftColor = "#ff6a00";
  
  const log = {
    decision: decision.finalDecision,
    reason: reason,
    timestamp: new Date().toISOString(),
    type: "Decision Override",
    decisionId: decisionId
  };
  
  overrideLogs.push(log);
  saveOverrideLogToMongoDB(log);
  
  updateOverrideLogs();
  showMessage("⚠️ Decision overridden - excluded from AI learning");
  logProcess("⚠️", `Decision ${decisionId} overridden: ${reason}`);
  saveMemoryToLocalStorage();
};

function updateOverrideLogs() {
  const container = document.getElementById("overrideLogsList");
  
  if (overrideLogs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">No override logs yet</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = '';
  
  overrideLogs.slice().reverse().forEach(log => {
    const card = document.createElement("div");
    card.className = "override-log-card";
    
    card.innerHTML = `
      <div class="log-header">
        <div class="log-title">${log.type}</div>
        <div class="log-time">${new Date(log.timestamp).toLocaleString()}</div>
      </div>
      <div class="log-decision"><strong>Decision:</strong> ${log.decision}</div>
      <div class="log-reason"><strong>Human Reasoning:</strong> ${log.reason}</div>
    `;
    
    container.appendChild(card);
  });
}

async function fetchRoute(start, end) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=true`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('No route found');
    }
    
    return data.routes.map(route => ({
      coordinates: route.geometry.coordinates.map(c => [c[1], c[0]]),
      distance: route.distance,
      duration: route.duration
    }));
  } catch (error) {
    logProcess("❌", `Route calculation failed: ${error.message}`);
    return null;
  }
}

function findIntersectionPoint(r1, r2) {
  const threshold = 0.001;
  
  for (let p1 of r1) {
    for (let p2 of r2) {
      const distance = Math.sqrt(
        Math.pow(p1[0] - p2[0], 2) + 
        Math.pow(p1[1] - p2[1], 2)
      );
      if (distance < threshold) {
        return p1;
      }
    }
  }
  return null;
}

async function findBestAlternativeRoute(routes, otherRoute) {
  logProcess("🔄", "Analyzing alternative routes to avoid conflict...");
  
  for (let i = 1; i < routes.length; i++) {
    const intersection = findIntersectionPoint(routes[i].coordinates, otherRoute);
    if (!intersection) {
      logProcess("✓", `Alternative route ${i} found with no conflict`);
      return routes[i];
    }
  }
  
  logProcess("⚠️", "All routes intersect - selecting route with minimal delay");
  return routes[1] || routes[0];
}

let intersectionPoint = null;
let bReleased = false;

window.runSimulation = async function() {
  if (!ambulanceA.start || !ambulanceA.end || !ambulanceB.start || !ambulanceB.end) {
    alert("Please configure both ambulances before running simulation");
    showMessage("⚠️ Configuration incomplete");
    return;
  }
  
  showMessage("🚀 Initiating emergency routing simulation...");
  logProcess("🚀", "═══ SIMULATION STARTED ═══");
  logProcess("📍", `Ambulance A: [${ambulanceA.start.lat.toFixed(4)}, ${ambulanceA.start.lng.toFixed(4)}] → [${ambulanceA.end.lat.toFixed(4)}, ${ambulanceA.end.lng.toFixed(4)}]`);
  logProcess("📍", `Ambulance B: [${ambulanceB.start.lat.toFixed(4)}, ${ambulanceB.start.lng.toFixed(4)}] → [${ambulanceB.end.lat.toFixed(4)}, ${ambulanceB.end.lng.toFixed(4)}]`);
  
  const pA = parseInt(document.getElementById("priorityA").value);
  const pB = parseInt(document.getElementById("priorityB").value);
  
  logProcess("🎯", `Priority levels - A: P${pA}, B: P${pB}`);
  logProcess("🧮", "Calculating optimal routes with alternatives...");
  
  const routesA = await fetchRoute(ambulanceA.start, ambulanceA.end);
  const routesB = await fetchRoute(ambulanceB.start, ambulanceB.end);
  
  if (!routesA || !routesB) {
    alert("Failed to calculate routes. Please check the locations.");
    logProcess("❌", "Route calculation failed");
    return;
  }
  
  ambulanceA.route = routesA[0].coordinates;
  ambulanceB.route = routesB[0].coordinates;
  
  logProcess("✓", `Route A calculated: ${routesA[0].distance.toFixed(0)}m, ${(routesA[0].duration/60).toFixed(1)} min, ${routesA.length} alternatives`);
  logProcess("✓", `Route B calculated: ${routesB[0].distance.toFixed(0)}m, ${(routesB[0].duration/60).toFixed(1)} min, ${routesB.length} alternatives`);
  
  if (ambulanceA.line) map.removeLayer(ambulanceA.line);
  if (ambulanceB.line) map.removeLayer(ambulanceB.line);
  
  ambulanceA.line = L.polyline(ambulanceA.route, { 
    color: "#4285F4", 
    weight: 5,
    opacity: 0.7
  }).addTo(map);
  
  ambulanceB.line = L.polyline(ambulanceB.route, { 
    color: "#EA4335", 
    weight: 5,
    opacity: 0.7
  }).addTo(map);
  
  logProcess("🔍", "Analyzing route intersection conflicts...");
  
  intersectionPoint = findIntersectionPoint(ambulanceA.route, ambulanceB.route);
  
  if (intersectionPoint) {
    logProcess("⚠️", `CONFLICT DETECTED at [${intersectionPoint[0].toFixed(4)}, ${intersectionPoint[1].toFixed(4)}]`);
    metrics.conflicts++;
    updateMetrics();
    updateMetricsInMongoDB(metrics);
    
    L.circleMarker(intersectionPoint, {
      radius: 8,
      fillColor: "#ff0000",
      color: "#fff",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(map).bindPopup("⚠️ Conflict Point");
    
    await handleConflictWithOptimization(pA, pB, routesA, routesB);
  } else {
    logProcess("✓", "No route conflicts detected - proceeding with optimal routes");
    
    const decision = recordDecision({
      scenario: { priorityPattern: `A:${pA}-B:${pB}`, conflict: false },
      intent: "Normal routing without conflict",
      constraints: ["No intersection detected"],
      alternatives: ["N/A"],
      finalDecision: "Proceed with optimal routes",
      reasoning: "No route conflict - both ambulances can proceed independently",
      outcome: "Both ambulances dispatched successfully"
    });
    
    const similar = await getSimilarDecisionsFromMongoDB(decision.scenario);
    renderDecisionMemory(decision, similar);
    
    logProcess("▶️", "Starting ambulance movement...");
    animateAmbulances();
  }
};

async function handleConflictWithOptimization(pA, pB, routesA, routesB) {
  if (pA === 1 && pB === 1) {
    logProcess("🔄", "Both ambulances Priority 1 (Critical) - initiating dynamic rerouting...");
    
    const recommendation = {
      decision: "Dynamic Rerouting - Optimize Ambulance B path",
      reasoning: [
        "Both ambulances have Priority 1 (Critical - Life Threatening) status",
        "Intersection conflict creates potential deadlock situation",
        `Ambulance A: ${routesA[0].distance.toFixed(0)}m distance, ${(routesA[0].duration/60).toFixed(1)} min ETA`,
        `Ambulance B: ${routesB.length} alternative routes available`,
        "AI analyzing all alternatives to find conflict-free path",
        "Dynamic rerouting minimizes total system delay while maintaining P1 response",
        "Route optimization ensures both critical patients receive timely care"
      ],
      confidence: 95,
      approved: false,
      learningEnabled: false
    };
    
    renderAIRecommendation(recommendation);
    
    logProcess("🔄", "Searching for optimal alternative route...");
    const alternativeRoute = await findBestAlternativeRoute(routesB, ambulanceA.route);
    
    if (alternativeRoute && alternativeRoute !== routesB[0]) {
      ambulanceB.route = alternativeRoute.coordinates;
      
      if (ambulanceB.line) map.removeLayer(ambulanceB.line);
      ambulanceB.line = L.polyline(ambulanceB.route, { 
        color: "#EA4335", 
        weight: 5, 
        dashArray: '10, 10',
        opacity: 0.7
      }).addTo(map);
      
      logProcess("✓", `Ambulance B rerouted: ${alternativeRoute.distance.toFixed(0)}m, ${(alternativeRoute.duration/60).toFixed(1)} min (optimized alternative)`);
    } else {
      logProcess("⚠️", "No conflict-free alternative found - using timed coordination");
    }
    
    const decision = recordDecision({
      scenario: { priorityPattern: "A:1-B:1", conflict: true },
      intent: "Avoid deadlock between critical ambulances with optimization",
      constraints: ["Both Priority 1", "Intersection conflict", "Time-critical", "Patient survival"],
      alternatives: ["Green corridor", "Reroute A", "Dynamic reroute B", "Coordinate timing"],
      finalDecision: "Dynamic Rerouting with route optimization for Ambulance B",
      reasoning: "AI-selected optimal alternative route minimizes total delay while maintaining P1 response for both",
      outcome: "Conflict resolved - both ambulances proceed safely on optimized paths"
    });
    
    const similar = await getSimilarDecisionsFromMongoDB(decision.scenario);
    renderDecisionMemory(decision, similar);
    
    logProcess("▶️", "Dispatching both ambulances on optimized routes...");
    animateAmbulances();
    
  } else if (pA < pB) {
    logProcess("🚦", `Ambulance A (P${pA}) has higher priority than Ambulance B (P${pB})`);
    
    const recommendation = {
      decision: "Deploy Green Corridor for Ambulance A",
      reasoning: [
        `Ambulance A has Priority ${pA} (higher urgency)`,
        `Ambulance B has Priority ${pB} (lower urgency)`,
        "Green corridor protocol: higher priority vehicle passes first",
        "Lower priority vehicle yields at intersection",
        "Maintains emergency response hierarchy and safety standards",
        `Expected delay for Ambulance B: ~${((routesB[0].duration - routesA[0].duration)/60).toFixed(1)} minutes`,
        "Traffic signal coordination activated for priority passage"
      ],
      confidence: 98,
      approved: false,
      learningEnabled: false
    };
    
    renderAIRecommendation(recommendation);
    
    L.marker(intersectionPoint, { 
      icon: L.divIcon({
        html: "<div style='font-size:40px'>🚦</div>",
        iconSize: [40, 40],
        className: ''
      })
    }).addTo(map).bindPopup("🚦 Green Corridor Active");
    
    metrics.greenCorridors++;
    updateMetrics();
    updateMetricsInMongoDB(metrics);
    
    logProcess("🚦", "Green Corridor activated - traffic signals coordinated");
    
    const decision = recordDecision({
      scenario: { priorityPattern: `A:${pA}-B:${pB}`, conflict: true },
      intent: "Prioritize higher-priority emergency vehicle",
      constraints: ["Intersection conflict", "Priority difference", "Safety protocols"],
      alternatives: ["Reroute lower priority", "Coordinate timing"],
      finalDecision: "Green Corridor for Ambulance A with traffic coordination",
      reasoning: "Standard priority protocol - higher priority vehicle passes first with automated traffic control",
      outcome: "Higher priority ambulance cleared safely - lower priority yielded with minimal delay"
    });
    
    const similar = await getSimilarDecisionsFromMongoDB(decision.scenario);
    renderDecisionMemory(decision, similar);
    
    logProcess("▶️", "Coordinated dispatch - A priority, B yielding...");
    moveAmbulanceAControlled();
    moveAmbulanceBControlled();
    
  } else if (pB < pA) {
    logProcess("🚦", `Ambulance B (P${pB}) has higher priority than Ambulance A (P${pA})`);
    
    const recommendation = {
      decision: "Deploy Green Corridor for Ambulance B",
      reasoning: [
        `Ambulance B has Priority ${pB} (higher urgency)`,
        `Ambulance A has Priority ${pA} (lower urgency)`,
        "Green corridor protocol: higher priority vehicle passes first",
        "Lower priority vehicle yields at intersection",
        "Maintains emergency response hierarchy and safety standards",
        `Expected delay for Ambulance A: ~${((routesA[0].duration - routesB[0].duration)/60).toFixed(1)} minutes`,
        "Traffic signal coordination activated for priority passage"
      ],
      confidence: 98,
      approved: false,
      learningEnabled: false
    };
    
    renderAIRecommendation(recommendation);
    
    L.marker(intersectionPoint, { 
      icon: L.divIcon({
        html: "<div style='font-size:40px'>🚦</div>",
        iconSize: [40, 40],
        className: ''
      })
    }).addTo(map).bindPopup("🚦 Green Corridor Active");
    
    metrics.greenCorridors++;
    updateMetrics();
    updateMetricsInMongoDB(metrics);
    
    logProcess("🚦", "Green Corridor activated - traffic signals coordinated");
    
    const decision = recordDecision({
      scenario: { priorityPattern: `A:${pA}-B:${pB}`, conflict: true },
      intent: "Prioritize higher-priority emergency vehicle",
      constraints: ["Intersection conflict", "Priority difference", "Safety protocols"],
      alternatives: ["Reroute lower priority", "Coordinate timing"],
      finalDecision: "Green Corridor for Ambulance B with traffic coordination",
      reasoning: "Standard priority protocol - higher priority vehicle passes first with automated traffic control",
      outcome: "Higher priority ambulance cleared safely - lower priority yielded with minimal delay"
    });
    
    const similar = await getSimilarDecisionsFromMongoDB(decision.scenario);
    renderDecisionMemory(decision, similar);
    
    logProcess("▶️", "Coordinated dispatch - B priority, A yielding...");
    moveAmbulanceBControlled();
    moveAmbulanceAControlled();
    
  } else {
    logProcess("⚖️", `Equal priority (P${pA}) - optimizing based on route efficiency...`);
    
    const distanceA = routesA[0].distance;
    const distanceB = routesB[0].distance;
    const priorityVehicle = distanceA < distanceB ? 'A' : 'B';
    
    const recommendation = {
      decision: `Optimize based on route efficiency - Priority to Ambulance ${priorityVehicle}`,
      reasoning: [
        `Both ambulances have Priority ${pA} (equal urgency)`,
        `Ambulance A: ${distanceA.toFixed(0)}m distance, ${(routesA[0].duration/60).toFixed(1)} min ETA`,
        `Ambulance B: ${distanceB.toFixed(0)}m distance, ${(routesB[0].duration/60).toFixed(1)} min ETA`,
        "AI optimization: shorter route gets priority to minimize overall system delay",
        "Fair allocation based on objective metrics and efficiency",
        "Maintains service quality for both emergency calls"
      ],
      confidence: 90,
      approved: false,
      learningEnabled: false
    };
    
    renderAIRecommendation(recommendation);
    
    logProcess("⚖️", `Route optimization: Ambulance ${priorityVehicle} has shorter distance`);
    
    const decision = recordDecision({
      scenario: { priorityPattern: `A:${pA}-B:${pB}`, conflict: true },
      intent: "Optimize for efficiency with equal priority",
      constraints: ["Equal priority", "Intersection conflict", "System efficiency"],
      alternatives: ["First-come-first-served", "Distance-based", "Time-based"],
      finalDecision: `Distance-based priority - Ambulance ${priorityVehicle} proceeds first`,
      reasoning: "Shorter route prioritized to minimize total system delay and optimize resource utilization",
      outcome: "Efficient resolution maintaining fairness and service quality"
    });
    
    const similar = await getSimilarDecisionsFromMongoDB(decision.scenario);
    renderDecisionMemory(decision, similar);
    
    if (priorityVehicle === 'A') {
      logProcess("▶️", "Ambulance A prioritized - shorter route");
      moveAmbulanceAControlled();
      moveAmbulanceBControlled();
    } else {
      logProcess("▶️", "Ambulance B prioritized - shorter route");
      moveAmbulanceBControlled();
      moveAmbulanceAControlled();
    }
  }
}

function moveAmbulanceAControlled() {
  let i = 0;
  ambulanceA.timer = setInterval(() => {
    if (i >= ambulanceA.route.length) {
      clearInterval(ambulanceA.timer);
      logProcess("🏁", "Ambulance A arrived at destination");
      return;
    }
    ambulanceA.marker.setLatLng(ambulanceA.route[i]);
    if (!bReleased && intersectionPoint &&
      Math.abs(ambulanceA.route[i][0] - intersectionPoint[0]) +
      Math.abs(ambulanceA.route[i][1] - intersectionPoint[1]) < 0.001) {
      bReleased = true;
      logProcess("✓", "Ambulance A cleared intersection - releasing Ambulance B");
    }
    i++;
  }, 90);
}

function moveAmbulanceBControlled() {
  let i = 0;
  let waiting = false;
  ambulanceB.timer = setInterval(() => {
    if (i >= ambulanceB.route.length) {
      clearInterval(ambulanceB.timer);
      logProcess("🏁", "Ambulance B arrived at destination");
      return;
    }
    
    if (!bReleased && intersectionPoint &&
      Math.abs(ambulanceB.route[i][0] - intersectionPoint[0]) +
      Math.abs(ambulanceB.route[i][1] - intersectionPoint[1]) < 0.001) {
      if (!waiting) {
        logProcess("⏸️", "Ambulance B yielding at intersection - waiting for priority vehicle");
        waiting = true;
      }
      return;
    }
    ambulanceB.marker.setLatLng(ambulanceB.route[i]);
    i++;
  }, 90);
}

function animateAmbulances() {
  moveSimple(ambulanceA, 'A');
  moveSimple(ambulanceB, 'B');
}

function moveSimple(amb, label) {
  let i = 0;
  amb.timer = setInterval(() => {
    if (i >= amb.route.length) {
      clearInterval(amb.timer);
      logProcess("🏁", `Ambulance ${label} arrived at destination successfully`);
      return;
    }
    amb.marker.setLatLng(amb.route[i++]);
  }, 90);
}

window.resetSimulation = function() {
  if (confirm("Are you sure you want to reset the entire simulation? This will clear the map but preserve decision memory.")) {
    location.reload();
  }
};

window.exportMemory = function() {
  const exportData = {
    decisionMemory: decisionMemory,
    overrideLogs: overrideLogs,
    metrics: metrics,
    exportDate: new Date().toISOString(),
    version: "1.0"
  };
  
  const dataStr = JSON.stringify(exportData, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `emergency-decisions-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  
  showMessage("📥 Decision memory exported successfully");
  logProcess("💾", "Decision memory exported to file");
};

window.importMemory = function() {
  document.getElementById("importFile").click();
};

window.handleImport = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importData = JSON.parse(e.target.result);
      
      if (importData.decisionMemory) {
        decisionMemory.length = 0;
        decisionMemory.push(...importData.decisionMemory);
      }
      
      if (importData.overrideLogs) {
        overrideLogs = importData.overrideLogs;
      }
      
      if (importData.metrics) {
        Object.assign(metrics, importData.metrics);
        updateMetrics();
      }
      
      saveMemoryToLocalStorage();
      location.reload();
      
      showMessage("📤 Decision memory imported successfully");
    } catch (error) {
      alert("Error importing file: " + error.message);
    }
  };
  reader.readAsText(file);
};

window.clearMemory = function() {
  if (confirm("Are you sure you want to clear ALL decision memory? This action cannot be undone!")) {
    decisionMemory.length = 0;
    overrideLogs = [];
    metrics = {
      aiSuggestions: 0,
      humanApprovals: 0,
      overrides: 0,
      conflicts: 0,
      greenCorridors: 0,
      totalDecisions: 0
    };
    updateMetrics();
    localStorage.removeItem('emergencyDecisionMemory');
    location.reload();
    showMessage("🗑️ All memory cleared");
  }
};

window.toggleMemoryView = function() {
  const container = document.getElementById("decisionMemoryList");
  if (container.style.display === "none") {
    container.style.display = "block";
  } else {
    container.style.display = "none";
  }
};

async function initializeFromMongoDB() {
  try {
    const metricsResult = await apiRequest('/metrics');
    if (metricsResult.data) {
      metrics = {
        aiSuggestions: metricsResult.data.aiSuggestions || 0,
        humanApprovals: metricsResult.data.humanApprovals || 0,
        overrides: metricsResult.data.overrides || 0,
        conflicts: metricsResult.data.conflicts || 0,
        greenCorridors: metricsResult.data.greenCorridors || 0,
        totalDecisions: metricsResult.data.totalDecisions || 0
      };
      updateMetrics();
    }
    
    refreshHistoricalData();
    
    logProcess("✓", "Data synchronized with MongoDB");
  } catch (error) {
    logProcess("⚠️", "Could not connect to MongoDB - using local storage");
  }
}

updateMetrics();
updateOverrideLogs();

document.getElementById("aiRecommendation").innerHTML = `
  <div class="empty-state">
    <div class="empty-state-icon">🤖</div>
    <div class="empty-state-text">AI recommendations will appear here during simulation</div>
  </div>
`;

document.getElementById("decisionMemoryList").innerHTML = `
  <div class="empty-state">
    <div class="empty-state-icon">🧠</div>
    <div class="empty-state-text">Decision memory timeline will appear here</div>
  </div>
`;

document.getElementById("processLog").innerHTML = `
  <div class="empty-state">
    <div class="empty-state-icon">📋</div>
    <div class="empty-state-text">Process logs will appear here</div>
  </div>
`;

logProcess("✓", "System initialized - Ready for emergency routing");

initializeFromMongoDB();
