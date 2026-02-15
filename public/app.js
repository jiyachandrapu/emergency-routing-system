
// ==================== CONFIGURATION ====================
const API_BASE_URL = 'http://localhost:3000/api';

// ==================== STATE ====================
const decisionMemory = [];
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
let currentHistoryTab = 'decisions';

// ==================== UTILITIES ====================
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
    return null;
  }
}

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

// ==================== MAP INITIALIZATION ====================
console.log("Initializing map...");
console.log("Leaflet available:", typeof L !== 'undefined');

const map = L.map("map").setView([17.385, 78.4867], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

console.log("Map initialized successfully!");

// Force map to invalidate size after a short delay
setTimeout(() => {
  map.invalidateSize();
  console.log("Map size invalidated");
}, 100);

// ==================== AMBULANCE SELECTION ====================
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
  logProcess("📍", `Selection mode: Ambulance ${ambulance} - ${type}`);
  map.getContainer().style.cursor = 'crosshair';
};

map.on('click', function(e) {
  if (!selectionMode) return;
  
  const { ambulance, type } = selectionMode;
  const amb = ambulance === 'A' ? ambulanceA : ambulanceB;
  const coords = e.latlng;
  
  if (type === 'start') {
    amb.start = coords;
    
    if (amb.startMarker) map.removeLayer(amb.startMarker);
    
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
    logProcess("✓", `Ambulance ${ambulance} start set`);
    
  } else if (type === 'end') {
    amb.end = coords;
    
    if (amb.endMarker) map.removeLayer(amb.endMarker);
    
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
    logProcess("✓", `Ambulance ${ambulance} destination set`);
  }
  
  selectionMode = null;
  map.getContainer().style.cursor = '';
  showMessage(`✓ Location set for Ambulance ${ambulance}`);
});

// ==================== DECISION RECORDING ====================
function recordDecision({ scenario, intent, constraints, alternatives, finalDecision, reasoning, outcome }) {
  const decision = {
    decision_id: `EMG-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    scenario,
    intent,
    constraints,
    alternatives,
    finalDecision,
    reasoning,
    outcome,
    approved: false,
    overridden: false,
    learningEnabled: false
  };
  
  decisionMemory.push(decision);
  return decision;
}

function findSimilarDecisions(scenario) {
  return decisionMemory.filter(d =>
    d.learningEnabled === true &&
    !d.overridden &&
    d.scenario.conflict === scenario.conflict &&
    d.scenario.priorityPattern === scenario.priorityPattern
  );
}

// ==================== AI RECOMMENDATION ====================
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
  apiRequest('/metrics', {
    method: 'PUT',
    body: JSON.stringify(metrics)
  });
  logProcess("🤖", "AI recommendation generated");
}

window.approveRecommendation = function() {
  if (!currentRecommendation) return;
  
  metrics.humanApprovals++;
  updateMetrics();
  
  document.getElementById("recStatus").innerHTML = `
    <div class="rec-status status-approved">
      ✓ Human Approved - Decision accepted
    </div>
  `;
  
  currentRecommendation.approved = true;
  currentRecommendation.learningEnabled = true;
  
  showMessage("✅ AI recommendation approved");
  logProcess("✓", "AI recommendation approved");
  
  apiRequest('/metrics', {
    method: 'PUT',
    body: JSON.stringify(metrics)
  });
};

window.overrideRecommendation = function() {
  if (!currentRecommendation) return;
  
  const reason = prompt("Reason for override:");
  if (!reason) return;
  
  metrics.overrides++;
  updateMetrics();
  
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
  updateOverrideLogs();
  showMessage("⚠️ AI recommendation overridden");
  logProcess("⚠️", `Overridden: ${reason}`);
  
  apiRequest('/override-logs', {
    method: 'POST',
    body: JSON.stringify(log)
  });
  
  apiRequest('/metrics', {
    method: 'PUT',
    body: JSON.stringify(metrics)
  });
};

// ==================== DECISION MEMORY ====================
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
        <div class="recall-header">🧠 AI Recall: ${similarDecisions.length} Similar Decision(s) Found</div>
        <div class="recall-content">
          Found ${similarDecisions.length} similar decision(s) from past experiences.
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
  
  decision.similarDecisions = similarDecisions;
  
  apiRequest('/decisions', {
    method: 'POST',
    body: JSON.stringify(decision)
  });
  
  apiRequest('/metrics', {
    method: 'PUT',
    body: JSON.stringify(metrics)
  });
  
  logProcess("🧠", `Decision recorded: ${decision.decision_id}`);
}

window.viewRecalledDecisions = function(decisionId) {
  const decision = decisionMemory.find(d => d.decision_id === decisionId);
  if (!decision || !decision.similarDecisions) return;
  
  const similar = decision.similarDecisions;
  
  let message = `AI RECALLED ${similar.length} SIMILAR DECISION(S):\n\n`;
  
  similar.forEach((d, index) => {
    message += `━━━ Decision ${index + 1} ━━━\n`;
    message += `ID: ${d.decision_id}\n`;
    message += `Decision: ${d.finalDecision}\n`;
    message += `Reasoning: ${d.reasoning}\n`;
    message += `Date: ${new Date(d.timestamp).toLocaleString()}\n\n`;
  });
  
  alert(message);
  showMessage(`Showing ${similar.length} recalled decision(s)`);
};

window.approveDecision = async function(decisionId) {
  const decision = decisionMemory.find(d => d.decision_id === decisionId);
  if (!decision) return;
  
  decision.approved = true;
  decision.learningEnabled = true;
  
  metrics.humanApprovals++;
  updateMetrics();
  
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
      ✓ Approved - Added to AI Learning Memory
    </div>
  `;
  
  const card = document.getElementById(`decision-${decisionId}`);
  card.style.borderLeftColor = "#38ef7d";
  
  showMessage("✅ Decision approved");
  logProcess("✓", `Decision ${decisionId} approved`);
  
  apiRequest('/metrics', {
    method: 'PUT',
    body: JSON.stringify(metrics)
  });
};

window.overrideDecision = async function(decisionId) {
  const decision = decisionMemory.find(d => d.decision_id === decisionId);
  if (!decision) return;
  
  const reason = prompt("Reason for override:");
  if (!reason) return;
  
  decision.overridden = true;
  decision.learningEnabled = false;
  decision.overrideReason = reason;
  
  metrics.overrides++;
  updateMetrics();
  
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
      ✗ Overridden - Excluded from AI Learning
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
  updateOverrideLogs();
  showMessage("⚠️ Decision overridden");
  logProcess("⚠️", `Decision overridden: ${reason}`);
  
  apiRequest('/override-logs', {
    method: 'POST',
    body: JSON.stringify(log)
  });
  
  apiRequest('/metrics', {
    method: 'PUT',
    body: JSON.stringify(metrics)
  });
};

// ==================== OVERRIDE LOGS ====================
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
      <div class="log-reason"><strong>Reason:</strong> ${log.reason}</div>
    `;
    
    container.appendChild(card);
  });
}

// ==================== HISTORICAL DATA ====================
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
    
    const result = await apiRequest('/decisions?page=1&limit=20');
    
    if (!result || result.data.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📚</div>
          <div class="empty-state-text">No historical data in database</div>
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
      `;
      container.appendChild(pagination);
    }
    
    logProcess("📚", `Loaded ${result.data.length} historical decisions`);
  }
};

async function loadAndDisplayAnalytics() {
  const container = document.getElementById('historicalData');
  container.innerHTML = '<div class="loading-spinner"></div>';
  
  const result = await apiRequest('/analytics/stats');
  
  if (!result) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <div class="empty-state-text">Analytics not available</div>
      </div>
    `;
    return;
  }
  
  const analytics = result.data;
  
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
  
  logProcess("📊", "Analytics loaded");
}

// ==================== ROUTING ====================
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
    logProcess("❌", `Route failed: ${error.message}`);
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
  logProcess("🔄", "Analyzing alternatives...");
  
  for (let i = 1; i < routes.length; i++) {
    const intersection = findIntersectionPoint(routes[i].coordinates, otherRoute);
    if (!intersection) {
      logProcess("✓", `Alternative route ${i} found`);
      return routes[i];
    }
  }
  
  return routes[1] || routes[0];
}

// ==================== SIMULATION ====================
let intersectionPoint = null;
let bReleased = false;

window.runSimulation = async function() {
  if (!ambulanceA.start || !ambulanceA.end || !ambulanceB.start || !ambulanceB.end) {
    alert("Please configure both ambulances");
    return;
  }
  
  showMessage("🚀 Starting simulation...");
  logProcess("🚀", "SIMULATION STARTED");
  
  const pA = parseInt(document.getElementById("priorityA").value);
  const pB = parseInt(document.getElementById("priorityB").value);
  
  logProcess("🧮", "Calculating routes...");
  
  const routesA = await fetchRoute(ambulanceA.start, ambulanceA.end);
  const routesB = await fetchRoute(ambulanceB.start, ambulanceB.end);
  
  if (!routesA || !routesB) {
    alert("Route calculation failed");
    return;
  }
  
  ambulanceA.route = routesA[0].coordinates;
  ambulanceB.route = routesB[0].coordinates;
  
  logProcess("✓", `Routes calculated`);
  
  if (ambulanceA.line) map.removeLayer(ambulanceA.line);
  if (ambulanceB.line) map.removeLayer(ambulanceB.line);
  
  ambulanceA.line = L.polyline(ambulanceA.route, { 
    color: "#4285F4", 
    weight: 5
  }).addTo(map);
  
  ambulanceB.line = L.polyline(ambulanceB.route, { 
    color: "#EA4335", 
    weight: 5
  }).addTo(map);
  
  logProcess("🔍", "Checking conflicts...");
  
  intersectionPoint = findIntersectionPoint(ambulanceA.route, ambulanceB.route);
  
  if (intersectionPoint) {
    logProcess("⚠️", "CONFLICT DETECTED");
    metrics.conflicts++;
    updateMetrics();
    
    L.circleMarker(intersectionPoint, {
      radius: 8,
      fillColor: "#ff0000",
      color: "#fff",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    }).addTo(map);
    
    await handleConflict(pA, pB, routesA, routesB);
  } else {
    logProcess("✓", "No conflicts");
    
    const decision = recordDecision({
      scenario: { priorityPattern: `A:${pA}-B:${pB}`, conflict: false },
      intent: "Normal routing",
      constraints: ["No intersection"],
      alternatives: ["N/A"],
      finalDecision: "Proceed with optimal routes",
      reasoning: "No conflict detected",
      outcome: "Success"
    });
    
    const similar = findSimilarDecisions(decision.scenario);
    renderDecisionMemory(decision, similar);
    
    animateAmbulances();
  }
};

async function handleConflict(pA, pB, routesA, routesB) {
  if (pA === 1 && pB === 1) {
    const recommendation = {
      decision: "Reroute Ambulance B",
      reasoning: [
        "Both Priority 1 (Critical)",
        "Deadlock risk",
        `${routesB.length} alternatives available`,
        "Optimize total delay"
      ],
      confidence: 95
    };
    
    renderAIRecommendation(recommendation);
    
    const alt = await findBestAlternativeRoute(routesB, ambulanceA.route);
    
    if (alt && alt !== routesB[0]) {
      ambulanceB.route = alt.coordinates;
      
      if (ambulanceB.line) map.removeLayer(ambulanceB.line);
      ambulanceB.line = L.polyline(ambulanceB.route, { 
        color: "#EA4335", 
        weight: 5, 
        dashArray: '10, 10'
      }).addTo(map);
      
      logProcess("✓", "Ambulance B rerouted");
    }
    
    const decision = recordDecision({
      scenario: { priorityPattern: "A:1-B:1", conflict: true },
      intent: "Avoid deadlock",
      constraints: ["Both P1", "Intersection"],
      alternatives: ["Reroute B"],
      finalDecision: "Dynamic Rerouting B",
      reasoning: "Minimize total delay",
      outcome: "Resolved"
    });
    
    const similar = findSimilarDecisions(decision.scenario);
    renderDecisionMemory(decision, similar);
    
    animateAmbulances();
    
  } else if (pA < pB || pB < pA) {
    const priority = pA < pB ? 'A' : 'B';
    
    const recommendation = {
      decision: `Green Corridor for Ambulance ${priority}`,
      reasoning: [
        `Ambulance ${priority} has higher priority`,
        "Traffic coordination",
        "Safety protocols"
      ],
      confidence: 98
    };
    
    renderAIRecommendation(recommendation);
    
    L.marker(intersectionPoint, { 
      icon: L.divIcon({
        html: "<div style='font-size:40px'>🚦</div>",
        iconSize: [40, 40]
      })
    }).addTo(map);
    
    metrics.greenCorridors++;
    updateMetrics();
    
    logProcess("🚦", "Green Corridor activated");
    
    const decision = recordDecision({
      scenario: { priorityPattern: `A:${pA}-B:${pB}`, conflict: true },
      intent: "Prioritize higher priority",
      constraints: ["Intersection", "Priority diff"],
      alternatives: ["Reroute"],
      finalDecision: `Green Corridor ${priority}`,
      reasoning: "Priority protocol",
      outcome: "Higher priority passed"
    });
    
    const similar = findSimilarDecisions(decision.scenario);
    renderDecisionMemory(decision, similar);
    
    if (priority === 'A') {
      moveAControlled();
      moveBControlled();
    } else {
      moveBControlled();
      moveAControlled();
    }
  }
}

// ==================== ANIMATION ====================
function moveAControlled() {
  let i = 0;
  ambulanceA.timer = setInterval(() => {
    if (i >= ambulanceA.route.length) {
      clearInterval(ambulanceA.timer);
      logProcess("🏁", "Ambulance A arrived");
      return;
    }
    ambulanceA.marker.setLatLng(ambulanceA.route[i]);
    if (!bReleased && intersectionPoint &&
      Math.abs(ambulanceA.route[i][0] - intersectionPoint[0]) +
      Math.abs(ambulanceA.route[i][1] - intersectionPoint[1]) < 0.001) {
      bReleased = true;
      logProcess("✓", "A cleared intersection");
    }
    i++;
  }, 90);
}

function moveBControlled() {
  let i = 0;
  let waiting = false;
  ambulanceB.timer = setInterval(() => {
    if (i >= ambulanceB.route.length) {
      clearInterval(ambulanceB.timer);
      logProcess("🏁", "Ambulance B arrived");
      return;
    }
    
    if (!bReleased && intersectionPoint &&
      Math.abs(ambulanceB.route[i][0] - intersectionPoint[0]) +
      Math.abs(ambulanceB.route[i][1] - intersectionPoint[1]) < 0.001) {
      if (!waiting) {
        logProcess("⏸️", "B waiting");
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
      logProcess("🏁", `Ambulance ${label} arrived`);
      return;
    }
    amb.marker.setLatLng(amb.route[i++]);
  }, 90);
}

// ==================== MEMORY MANAGEMENT ====================
window.resetSimulation = function() {
  if (confirm("Reset simulation?")) {
    location.reload();
  }
};

window.exportMemory = function() {
  const data = {
    decisionMemory,
    overrideLogs,
    metrics,
    exportDate: new Date().toISOString()
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `emergency-decisions-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  
  showMessage("📥 Memory exported");
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
      const data = JSON.parse(e.target.result);
      
      if (data.decisionMemory) {
        decisionMemory.length = 0;
        decisionMemory.push(...data.decisionMemory);
      }
      
      if (data.overrideLogs) {
        overrideLogs = data.overrideLogs;
      }
      
      if (data.metrics) {
        Object.assign(metrics, data.metrics);
        updateMetrics();
      }
      
      location.reload();
    } catch (error) {
      alert("Import error: " + error.message);
    }
  };
  reader.readAsText(file);
};

window.clearMemory = function() {
  if (confirm("Clear ALL memory?")) {
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
    location.reload();
  }
};

window.toggleMemoryView = function() {
  const container = document.getElementById("decisionMemoryList");
  container.style.display = container.style.display === "none" ? "block" : "none";
};

// ==================== INITIALIZATION ====================
async function initialize() {
  try {
    const result = await apiRequest('/metrics');
    if (result && result.data) {
      metrics = {
        aiSuggestions: result.data.aiSuggestions || 0,
        humanApprovals: result.data.humanApprovals || 0,
        overrides: result.data.overrides || 0,
        conflicts: result.data.conflicts || 0,
        greenCorridors: result.data.greenCorridors || 0,
        totalDecisions: result.data.totalDecisions || 0
      };
      updateMetrics();
    }
    
    refreshHistoricalData();
    logProcess("✓", "MongoDB connected");
  } catch (error) {
    logProcess("⚠️", "Using local mode");
  }
}

updateMetrics();
updateOverrideLogs();

document.getElementById("aiRecommendation").innerHTML = `
  <div class="empty-state">
    <div class="empty-state-icon">🤖</div>
    <div class="empty-state-text">AI recommendations will appear here</div>
  </div>
`;

document.getElementById("decisionMemoryList").innerHTML = `
  <div class="empty-state">
    <div class="empty-state-icon">🧠</div>
    <div class="empty-state-text">Decision memory timeline</div>
  </div>
`;

document.getElementById("processLog").innerHTML = `
  <div class="empty-state">
    <div class="empty-state-icon">📋</div>
    <div class="empty-state-text">Process logs will appear here</div>
  </div>
`;

logProcess("✓", "System ready");
initialize();
