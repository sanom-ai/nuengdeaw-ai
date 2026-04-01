'use strict';

const fs = require('fs');
const path = require('path');

const FOUNDATION_PATH = path.join(__dirname, 'phasa-tawan-foundation.readable.json');
const foundation = JSON.parse(fs.readFileSync(FOUNDATION_PATH, 'utf8'));

const runtimeProfiles = foundation.standard?.runtime_profiles || {};
const knownNamespaces = foundation.standard?.namespace_system?.known_namespaces || [];
const centralStandard = foundation.central_standard || {};
const canonicalVocab = centralStandard.canonical_vocab || foundation.canonical_vocab || {};
const runtimeSnapshot = centralStandard.current_runtime_snapshot || {};

const namespaceMap = new Map();
for (const entry of knownNamespaces) {
  namespaceMap.set(String(entry.prefix || '').replace(/\.$/, ''), {
    prefix: String(entry.prefix || '').replace(/\.$/, ''),
    examples: entry.examples || [],
    meaning: entry.meaning || '',
  });
}

function setFrom(items = []) {
  return new Set(items.filter(Boolean).map((item) => String(item)));
}

const canonicalActions = setFrom(canonicalVocab.actions_for_runtime);
const canonicalStates = setFrom(canonicalVocab.psychological_states_for_runtime);
const canonicalSignals = setFrom(canonicalVocab.signal_primitives_for_runtime);
const canonicalTokens = new Set([...canonicalActions, ...canonicalStates, ...canonicalSignals]);

const runtimeActionTokens = new Set([
  ...setFrom(runtimeSnapshot.gen1_actions_in_code),
  ...setFrom(runtimeSnapshot.gen2_actions_in_code),
  ...setFrom((runtimeProfiles.gen1_rules || []).map((rule) => rule.action)),
  ...setFrom((runtimeProfiles.gen2_rules || []).map((rule) => rule.action)),
]);

const runtimeStateTokens = new Set([
  ...setFrom((runtimeSnapshot.core_states_in_code || []).map((state) => {
    const normalized = String(state);
    return normalized.startsWith('PS.') ? normalized : `PS.${normalized}`;
  })),
  ...setFrom(Object.values(runtimeProfiles.state_meta || {}).map((meta) => meta?.ps)),
]);

const extendedTokens = new Set([...canonicalTokens, ...runtimeActionTokens, ...runtimeStateTokens]);

function derivePsToStateMap() {
  const mapping = {};
  for (const [stateName, meta] of Object.entries(runtimeProfiles.state_meta || {})) {
    if (!meta?.ps) {
      continue;
    }
    mapping[String(meta.ps)] = String(stateName);
  }

  const runtimeOnlyStateAliases = {
    'PS.AMBIGUOUS': 'CONFUSION',
    'PS.IDLE': 'NEUTRAL',
    'PS.STRESS': 'STRESS',
  };

  for (const [token, state] of Object.entries(runtimeOnlyStateAliases)) {
    if (!mapping[token]) {
      mapping[token] = state;
    }
  }

  return mapping;
}

const psToState = derivePsToStateMap();

const actionProfiles = {
  'ACT.ANCHOR': { taskType: 'concentration', empathy: 'encouragement', timePressure: 0.1, usesIntensity: true },
  'ACT.BREAK': { taskType: 'neutral', taskDifficulty: 0.2, timePressure: 0.05, empathy: 'calm_presence' },
  'ACT.CHALLENGE': { taskType: 'problem_solving', taskDifficulty: 0.8, usesLevel: true },
  'ACT.CLARIFY': { taskType: 'concentration', taskDifficulty: 0.3 },
  'ACT.CONTINUE': {},
  'ACT.ENRICH': { taskType: 'creativity', taskDifficulty: 0.7, usesLevel: true, triggerEvent: ['success', 0.2] },
  'ACT.EXPLORE': { taskType: 'creativity', triggerEvent: ['praise', 0.15] },
  'ACT.FREEZE': { taskType: 'neutral', taskDifficulty: 0.1, timePressure: 0 },
  'ACT.GROUND': { taskType: 'neutral', timePressure: 0.05, empathy: 'calm_presence' },
  'ACT.MAINTAIN': {},
  'ACT.REDIRECT': { taskType: 'neutral', timePressure: 0.15 },
  'ACT.REFRAME': { empathy: 'encouragement', triggerEvent: ['praise', 0.1] },
  'ACT.SIMPLIFY': { taskType: 'concentration', taskDifficulty: 0.25 },
  'ACT.STABILIZE': { taskType: 'neutral', timePressure: 0.1, empathy: 'stress_comfort' },
  'ACT.SUMMARIZE': { taskType: 'neutral', taskDifficulty: 0.25 },
  'ACT.SUSTAIN': { taskType: 'flow' },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function numberOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function splitStatements(script) {
  return String(script || '')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseArgs(rawArgs) {
  const args = {};
  for (const token of rawArgs) {
    const [key, rawValue] = token.split('=');
    if (!key) continue;
    if (rawValue == null) {
      args[key] = true;
      continue;
    }
    const numeric = Number(rawValue);
    args[key] = Number.isFinite(numeric) ? numeric : rawValue;
  }
  return args;
}

function classifyToken(token) {
  const [namespace] = String(token).split('.');
  return namespaceMap.get(namespace) ? namespace : null;
}

function parseStatement(statement) {
  const assignmentMatch = statement.match(/^([A-Z]{2}\.[A-Z0-9_]+)\s*=\s*(.+)$/);
  if (assignmentMatch) {
    const token = assignmentMatch[1];
    const rawValue = assignmentMatch[2].trim();
    const namespace = classifyToken(token);
    const numeric = Number(rawValue);
    return {
      type: 'assignment',
      token,
      namespace,
      value: Number.isFinite(numeric) ? numeric : rawValue,
      raw: statement,
      isCanonical: canonicalTokens.has(token),
      isKnown: extendedTokens.has(token) || Boolean(namespace),
    };
  }

  const chunks = statement.split(/\s+/).filter(Boolean);
  const token = chunks.shift();
  const args = parseArgs(chunks);
  const namespace = classifyToken(token);
  return {
    type: 'command',
    token,
    namespace,
    args,
    raw: statement,
    isCanonical: canonicalTokens.has(token),
    isKnown: extendedTokens.has(token) || Boolean(namespace),
  };
}

function validateOperation(operation, options = {}) {
  const strictMode = options.strictMode || 'warn';
  const issues = [];

  if (!operation.isKnown) {
    issues.push({
      level: strictMode === 'off' ? 'warning' : 'error',
      code: 'UNKNOWN_TOKEN',
      token: operation.token,
      raw: operation.raw,
      message: `Unknown token: ${operation.token}`,
    });
  }

  if (strictMode === 'strict' && !operation.isCanonical && operation.token.startsWith('ACT.')) {
    issues.push({
      level: 'error',
      code: 'NON_CANONICAL_ACTION',
      token: operation.token,
      raw: operation.raw,
      message: `Non-canonical action token: ${operation.token}`,
    });
  }

  if (strictMode === 'strict' && !operation.isCanonical && operation.token.startsWith('PS.')) {
    issues.push({
      level: 'error',
      code: 'NON_CANONICAL_STATE',
      token: operation.token,
      raw: operation.raw,
      message: `Non-canonical state token: ${operation.token}`,
    });
  }

  return issues;
}

function parseScript(script, options = {}) {
  const statements = splitStatements(script);
  const operations = statements.map(parseStatement);
  const issues = operations.flatMap((operation) => validateOperation(operation, options));
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level !== 'error');

  return {
    ok: errors.length === 0,
    strictMode: options.strictMode || 'warn',
    operations,
    errors,
    warnings,
    namespaces: [...new Set(operations.map((op) => op.namespace).filter(Boolean))],
  };
}

function buildEvaluationContext(input = {}) {
  const values = input.values || {};
  const z = input.z || {};
  const bands = input.bands || {};
  return {
    z,
    v: values,
    b: bands,
  };
}

function evaluateRuleCondition(condition, context) {
  const fn = new Function('z', 'v', 'b', `return (${condition});`);
  return Boolean(fn(context.z, context.v, context.b));
}

function evaluateSignals(input = {}, profile = 'gen2') {
  const rules = profile === 'gen1' ? runtimeProfiles.gen1_rules || [] : runtimeProfiles.gen2_rules || [];
  const context = buildEvaluationContext(input);
  const matches = [];

  for (const rule of rules) {
    let matched = false;
    try {
      matched = evaluateRuleCondition(rule.condition, context);
    } catch (error) {
      matches.push({
        id: rule.id,
        state: rule.state,
        action: rule.action,
        priority: rule.priority,
        matched: false,
        error: error.message,
      });
      continue;
    }

    if (matched) {
      matches.push({
        id: rule.id,
        state: rule.state,
        action: rule.action,
        priority: rule.priority,
        matched: true,
      });
    }
  }

  matches.sort((left, right) => left.priority - right.priority);
  const top = matches.find((match) => match.matched) || null;

  return {
    profile,
    matched: matches.filter((entry) => entry.matched),
    recommendation: top,
  };
}

function applyAssignmentsToContext(languageContext, operation) {
  if (!operation.namespace) {
    return;
  }

  const [group] = operation.token.split('.');
  const bucketName = {
    BS: 'signals',
    NS: 'bands',
    CS: 'computed',
    RT: 'relativeThresholds',
    AT: 'absoluteThresholds',
    PS: 'states',
    ACT: 'actions',
  }[group];

  if (!bucketName) {
    return;
  }

  if (!languageContext[bucketName]) {
    languageContext[bucketName] = {};
  }
  languageContext[bucketName][operation.token] = operation.value;
}

function applyActionProfile(sim, token, args = {}) {
  const profile = actionProfiles[token];
  if (!profile) {
    return false;
  }

  if (profile.taskType) sim.setTaskType(profile.taskType);
  if (profile.taskDifficulty != null) {
    const level = profile.usesLevel ? numberOr(args.level, profile.taskDifficulty) : profile.taskDifficulty;
    sim.setTaskDifficulty(clamp(level, 0, 1));
  }
  if (profile.timePressure != null) {
    const value = profile.usesIntensity
      ? clamp(profile.timePressure + numberOr(args.intensity, 0) * 0.2, 0, 1)
      : profile.timePressure;
    sim.setTimePressure(value);
  }
  if (profile.empathy) sim.applyEmpathy(profile.empathy);
  if (profile.triggerEvent) sim.triggerEvent(profile.triggerEvent[0], profile.triggerEvent[1]);

  return true;
}

function applyOperationToSim(sim, operation) {
  const result = {
    token: operation.token,
    raw: operation.raw,
    applied: false,
    effect: null,
  };

  if (operation.type === 'assignment') {
    result.applied = true;
    result.effect = 'stored_context';
    return result;
  }

  if (operation.token.startsWith('PS.')) {
    const state = psToState[operation.token];
    if (!state) {
      result.effect = 'unsupported_ps_token';
      return result;
    }
    sim.force(state);
    result.applied = true;
    result.effect = `force:${state}`;
    return result;
  }

  if (operation.token.startsWith('ACT.')) {
    if (!applyActionProfile(sim, operation.token, operation.args || {})) {
      result.effect = 'unsupported_action_token';
      return result;
    }
    result.applied = true;
    result.effect = `action:${operation.token}`;
    return result;
  }

  result.effect = 'validated_only';
  return result;
}

function validateFoundationSync() {
  const nonCanonicalActions = [...runtimeActionTokens].filter((token) => !canonicalActions.has(token));
  const nonCanonicalStates = [...runtimeStateTokens].filter((token) => !canonicalStates.has(token));
  const unmappedCanonicalStates = [...canonicalStates].filter((token) => !psToState[token]);

  return {
    ok: nonCanonicalActions.length === 0 && nonCanonicalStates.length === 0 && unmappedCanonicalStates.length === 0,
    nonCanonicalActions,
    nonCanonicalStates,
    unmappedCanonicalStates,
    recommendations: centralStandard.integration_audit?.recommendations || [],
  };
}

function applyScriptToSession(session, script, options = {}) {
  const parsed = parseScript(script, options);
  if (!session.languageContext) {
    session.languageContext = {};
  }

  if (parsed.errors.length > 0 && (options.strictMode || 'warn') === 'strict') {
    session.languageContext.lastScript = script;
    session.languageContext.lastParsedAt = new Date().toISOString();
    session.languageContext.lastStrictMode = options.strictMode || 'warn';
    return {
      ...parsed,
      applied: [],
      blocked: true,
    };
  }

  for (const operation of parsed.operations) {
    if (operation.type === 'assignment') {
      applyAssignmentsToContext(session.languageContext, operation);
    }
  }

  const applied = [];
  for (const operation of parsed.operations) {
    const operationIssues = validateOperation(operation, options).filter((issue) => issue.level === 'error');
    if (operationIssues.length > 0 && (options.strictMode || 'warn') !== 'off') {
      applied.push({
        token: operation.token,
        raw: operation.raw,
        applied: false,
        effect: 'blocked_by_validation',
      });
      continue;
    }
    applied.push(applyOperationToSim(session.runtime.HumanSim, operation));
  }

  session.languageContext.lastScript = script;
  session.languageContext.lastParsedAt = new Date().toISOString();
  session.languageContext.lastStrictMode = options.strictMode || 'warn';

  return {
    ...parsed,
    applied,
    blocked: false,
  };
}

function getFoundationSummary() {
  return {
    spec: foundation.standard?.spec_name || 'Phasa Tawan',
    version: foundation.standard?.version || foundation.version || 'unknown',
    namespaces: [...namespaceMap.keys()],
    actions: [...canonicalActions],
    states: [...canonicalStates],
    validation: validateFoundationSync(),
  };
}

module.exports = {
  FOUNDATION_PATH,
  foundation,
  parseScript,
  evaluateSignals,
  applyScriptToSession,
  getFoundationSummary,
  validateFoundationSync,
};
