


export const decisionMemory = [];

export function recordDecision({
  scenario,
  intent,
  constraints,
  alternatives,
  finalDecision,
  reasoning,
  outcome
}) {
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
    learningEnabled: false,
    overrideReason: null,
    userControlled: true,
    shareable: false,
    editable: true
  };
  
  decisionMemory.push(decision);
  console.log("🧠 Decision recorded:", decision);
  
  return decision;
}

export function findSimilarDecisionsByScenario(currentScenario, memory) {
  return memory.filter(d =>
    d.learningEnabled === true &&
    !d.overridden &&
    d.scenario.conflict === currentScenario.conflict &&
    d.scenario.priorityPattern === currentScenario.priorityPattern
  );
}

export function saveMemoryToLocalStorage() {
  try {
    const memoryData = {
      decisions: decisionMemory,
      lastSaved: new Date().toISOString(),
      version: "1.0"
    };
    localStorage.setItem('emergencyDecisionMemory', JSON.stringify(memoryData));
    console.log("💾 Memory saved to localStorage");
  } catch (error) {
    console.error("Error saving memory:", error);
  }
}

export function loadMemoryFromLocalStorage() {
  try {
    const saved = localStorage.getItem('emergencyDecisionMemory');
    if (saved) {
      const memoryData = JSON.parse(saved);
      decisionMemory.length = 0;
      decisionMemory.push(...memoryData.decisions);
      console.log("📂 Memory loaded:", decisionMemory.length, "decisions");
    }
  } catch (error) {
    console.error("Error loading memory:", error);
  }
}
