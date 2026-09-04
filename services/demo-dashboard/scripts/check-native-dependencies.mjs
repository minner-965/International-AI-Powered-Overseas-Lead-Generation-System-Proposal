const decisionGraph = {
  metadata: { version: 'native-smoke-v1' },
  nodes: [
    {
      id: 'input',
      type: 'inputNode',
      name: 'Smoke input',
      position: { x: 0, y: 0 },
      content: { schema: '' }
    },
    {
      id: 'calculate',
      type: 'functionNode',
      name: 'Deterministic native calculation',
      position: { x: 240, y: 0 },
      content: {
        source: "export const handler = async (input) => ({ status: Number(input.left) + Number(input.right) === 42 ? 'PASS' : 'FAIL', total: Number(input.left) + Number(input.right) });"
      }
    },
    {
      id: 'output',
      type: 'outputNode',
      name: 'Smoke output',
      position: { x: 520, y: 0 },
      content: { schema: '' }
    }
  ],
  edges: [
    { id: 'edge-input', sourceId: 'input', targetId: 'calculate', sourceHandle: null, type: 'edge' },
    { id: 'edge-output', sourceId: 'calculate', targetId: 'output', sourceHandle: null, type: 'edge' }
  ]
};

let engine;
try {
  const nativeModule = await import('@gorules/zen-engine');
  if (typeof nativeModule.ZenEngine !== 'function') {
    throw new TypeError('ZenEngine constructor is unavailable');
  }

  engine = new nativeModule.ZenEngine();
  if (typeof engine.createDecision !== 'function') {
    throw new TypeError('ZenEngine.createDecision is unavailable');
  }

  const decision = engine.createDecision(Buffer.from(JSON.stringify(decisionGraph)));
  if (!decision || typeof decision.evaluate !== 'function') {
    throw new TypeError('Decision.evaluate is unavailable');
  }

  const response = await decision.evaluate({ left: 19, right: 23 }, { trace: false });
  if (response?.result?.status !== 'PASS' || response?.result?.total !== 42) {
    throw new Error('Native decision returned a non-deterministic result');
  }

  process.stdout.write('GoRules native dependency smoke test: PASS\n');
} catch (error) {
  const name = String(error?.name || 'Error').replace(/[^A-Za-z0-9_.-]/g, '');
  const message = String(error?.message || 'Native dependency smoke test failed')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 240);
  process.stderr.write(`GoRules native dependency smoke test: FAIL (${name}: ${message})\n`);
  process.exitCode = 1;
} finally {
  try { engine?.dispose(); } catch {}
}
