/** Offline producer fixture. Run from the Interego checkout with:
 * node --import tsx /path/to/this/file.mjs /path/to/interego-checkout
 * No network, identity, private evidence, consent, or achievement writes. */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const producerRoot = resolve(process.argv[2] || process.cwd());
const moduleFrom = path => import(pathToFileURL(resolve(producerRoot, path)).href);
const [{ diagnose, recommendInterventions }, { scaffoldFromPlan }, { admissionOffer },
  { calibrate, buildCalibrationProfile }, { interventionMethods }] = await Promise.all([
  moduleFrom('applications/agentic-performance-practice/src/performance-architecture.ts'),
  moduleFrom('applications/foxxi-content-intelligence/src/emergent-content.ts'),
  moduleFrom('applications/agentic-performance-practice/src/content-admission.ts'),
  moduleFrom('applications/agentic-performance-practice/src/performance-calibration.ts'),
  moduleFrom('applications/agentic-performance-practice/src/intervention-methods.ts'),
]);
const classifiedBy = 'did:web:identity.example:agents:hallowmarch-u-pk-alice';
const base = 'https://foxxi-bridge.interego.xwisee.com';
const situation = {
  id: 'urn:hallowmarch:consultation:fd1aecae-550e-4cec-a5cd-04482f7b9167',
  performer: { id: 'did:web:identity.example:users:u-pk-alice', kind: 'human' },
  competency: 'Observe one completed craft after this refused attempt.',
  observed: 'An actual craft attempt was refused.',
  workContext: 'Use the recipe and tool references before a new real attempt.',
  frequency: 'frequent', criticality: 'moderate', modalStatus: 'Hypothetical',
  provenance: 'owner-browser-observed-gameplay',
};
const author = { id: classifiedBy, kind: 'agent', role: 'performance consultant (self, delegated)' };
const note = 'Classification attributed to your verified delegation. diagnosis.regimeSource is the provenance — supply trajectories to DERIVE the regime from signal (the honest, calibratable path); asserted/gap-intent carry no calibration authority. Compose your situation descriptor + the regime-appropriate intervention on your OWN pod from this.';
const cases = [undefined, 'Evident', 'Knowable', 'Emergent', 'Turbulent'];
const responses = cases.map(domain => {
  const current = { ...situation, ...(domain ? { domain } : {}) };
  const diagnosis = diagnose({ situation: current });
  const plan = recommendInterventions({ diagnosis, situation: current, author });
  const scaffold = scaffoldFromPlan(plan, current.competency);
  const calibration = calibrate(diagnosis, plan, buildCalibrationProfile([]));
  const admission = admissionOffer(plan, diagnosis, current, base);
  const body = JSON.parse(JSON.stringify({ classifiedBy, diagnosis, plan, scaffold,
    calibration, ...(admission ? { admission } : {}), note }));
  return { method: diagnosis.method, body };
});
const source = {
  repository: 'https://github.com/markjspivey-xwisee/interego',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: producerRoot, encoding: 'utf8' }).trim(),
  responseProjection: 'applications/agentic-performance-practice/compatibility/foxxi-performance-routes.ts POST /agent/contextualize-and-plan',
  generation: 'Offline actual producer functions, assembled with the route response projection, followed by a JSON stringify/parse wire roundtrip. No HTTP, relay, identity, or private-evidence operations. Example identities and observations are synthetic test inputs; this fixture is not live gameplay evidence.',
  command: 'node --import tsx /path/to/generate-foxxi-methodology-responses.mjs /path/to/interego-checkout',
  inputs: { situation, author, base, domains: cases.map(value => value ?? null), calibrationRecords: [], privateEvidence: false, privateReview: false },
  methods: interventionMethods().map(method => ({ '@id': method['@id'], token: method.token, version: method.version })),
};
const output = fileURLToPath(new URL('./foxxi-methodology-responses.json', import.meta.url));
writeFileSync(output, JSON.stringify({ source, responses }, null, 2) + '\n');
console.log(JSON.stringify({ output, revision: source.revision, methods: responses.map(item => item.method), bytes: responses.map(item => Buffer.byteLength(JSON.stringify(item.body))) }));
