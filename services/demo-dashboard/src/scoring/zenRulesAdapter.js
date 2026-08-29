import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZenEngine } from '@gorules/zen-engine';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const rulesRoot = process.env.DPV_RULES_DIR ? path.resolve(process.env.DPV_RULES_DIR) : path.join(projectRoot, 'rules');

const RULE_PATHS = Object.freeze({
  score: path.join(rulesRoot, 'dpv-score/v1/decision.json'),
  qualification: path.join(rulesRoot, 'qualification/v1/decision.json'),
  customerMatch: path.join(rulesRoot, 'customer-match/baseline-v1/decision.json'),
  cooperationFeasibility: path.join(rulesRoot, 'cooperation-feasibility/v1/decision.json')
});

export class DpvZenRulesAdapter {
  constructor({ rulePaths = RULE_PATHS } = {}) {
    this.rulePaths = rulePaths;
    this.engine = new ZenEngine();
    this.decisions = new Map();
  }

  async loadDecision(key) {
    if (!this.rulePaths[key]) throw new Error(`Unknown DPV decision: ${key}`);
    if (!this.decisions.has(key)) {
      const content = await fs.readFile(this.rulePaths[key]);
      this.decisions.set(key, this.engine.createDecision(content));
    }
    return this.decisions.get(key);
  }

  async evaluate(key, input, { trace = true } = {}) {
    const decision = await this.loadDecision(key);
    const response = await decision.evaluate(input, { trace });
    return { ...response.result, zen_trace: response.trace || null, zen_performance: response.performance };
  }

  dispose() {
    this.decisions.clear();
    this.engine.dispose();
  }
}

export class DpvScoringEngine {
  constructor({ adapter = new DpvZenRulesAdapter() } = {}) {
    this.adapter = adapter;
  }

  async evaluate(snapshot) {
    const score = await this.adapter.evaluate('score', snapshot);
    const qualification = await this.adapter.evaluate('qualification', {
      final_score: score.final_score,
      evidence_coverage: score.evidence_coverage,
      verification_status: snapshot.verification_status
    });
    return {
      ...score,
      score_eligibility: qualification.score_eligibility,
      qualification_status: qualification.qualification_status,
      reason_codes: [...new Set([...score.reason_codes, ...qualification.reason_codes])],
      qualification_rule_version: qualification.rule_version,
      qualification_trace: qualification.zen_trace
    };
  }

  dispose() {
    this.adapter.dispose();
  }
}
