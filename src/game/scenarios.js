// The guided loop's scenarios: one narrated package per conditional path of the
// factory v2 pipeline. Each step moves the package along tracks of the plant
// (see scene.js) and says what happens, why, who acts, which file is written and
// which condition picked the branch. Plain JS with no React imports, so it runs
// (and is tested) in Node. Not real job data: nothing here reads jobs, the board,
// GitHub or factory/config.json. Tests check the models against that file.
//
// Facts come from .claude/skills/factory/SKILL.md and .claude/agents/*.md.

const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

// Models of the agents that are not routed (factory/config.json `models`).
const MODELS = { intake: 'fable', 'spec-writer': 'opus', approver: 'opus' };
const LENSES = ['security', 'ux', 'ui', 'code'];

const agent = (name, model) => ({ name, model });
const other = (name) => ({ name, model: null });
const orquestador = other('orquestador');
const script = other('script');
const persona = other('persona');
const intake = agent('intake', MODELS.intake);
const specWriter = agent('spec-writer', MODELS['spec-writer']);
const approver = agent('approver', MODELS.approver);

// A scenario's job as route() sees it, and what route() picks for it.
const jobs = {
  medium: { job: { risk: 'medium', surfaces: ['ui'] }, routed: { builder: 'sonnet', reviewers: { ux: 'sonnet', ui: 'haiku', code: 'sonnet' } } },
  low: { job: { risk: 'low', surfaces: [] }, routed: { builder: 'sonnet', reviewers: { code: 'haiku' } } },
  security: { job: { risk: 'high', surfaces: ['security'] }, routed: { builder: 'opus', reviewers: { security: 'opus', code: 'sonnet' } } },
  all: {
    job: { risk: 'high', surfaces: ['security', 'ui'] },
    routed: { builder: 'opus', reviewers: { security: 'opus', ux: 'sonnet', ui: 'haiku', code: 'sonnet' } },
  },
  plain: { job: { risk: 'medium', surfaces: [] }, routed: { builder: 'sonnet', reviewers: { code: 'sonnet' } } },
};

const builderOf = ({ routed }) => agent('builder', routed.builder);
const reviewersOf = ({ routed }) => LENSES.filter((lens) => lens in routed.reviewers).map((lens) => agent(`review-${lens}`, routed.reviewers[lens]));
const reviewFiles = (round, { routed }) =>
  LENSES.filter((lens) => lens in routed.reviewers)
    .map((lens) => `round-${round}/review-${lens}.md`)
    .join(', ');
const lensList = ({ routed }) => LENSES.filter((lens) => lens in routed.reviewers).join(', ');

const step = (path, text, actors, file, condition = null) => ({ path, text, actors, file, condition });

const happy = jobs.medium;
const changes = jobs.security;
const gateFail = jobs.low;
const escalate = jobs.all;
const awaiting = jobs.medium;
const humanMerge = jobs.plain;
const rework = jobs.security;
const closed = jobs.all;

export const SCENARIOS = deepFreeze([
  {
    id: 'auto-merge-on',
    title: 'Camino feliz con auto_merge',
    hint: 'Todas las estaciones → merged',
    summary:
      'Un issue pasa por todas las estaciones, de la cola al merge. Con auto_merge activo el job termina solo, sin esperar a una persona.',
    ...happy,
    steps: [
      step(['queue'], 'El orquestador ve un issue abierto con la etiqueta factory y crea el job en la cola.', [orquestador], 'job.json'),
      step(
        ['queue', 'intake'],
        'intake lee el issue como dato citado y decide ACCEPT: el pedido es claro y cabe en un job. Anota riesgo medio y superficie ui.',
        [intake],
        'intake.md',
      ),
      step(
        ['intake', 'route'],
        'El script route traduce riesgo y superficies en modelos: builder sonnet y revisores ux, ui y code. Después crea el worktree.',
        [script],
        'job.json',
      ),
      step(
        ['route', 'spec'],
        'El spec-writer convierte el issue, dentro del alcance de intake, en criterios de aceptación numerados.',
        [specWriter],
        'spec.md',
      ),
      step(
        ['spec', 'build'],
        'El builder (sonnet, porque el riesgo es medio) escribe un test por criterio, implementa, hace commit y abre el PR.',
        [builderOf(happy)],
        'build.md',
      ),
      step(
        ['build', 'gate'],
        'El gate corre factory/checks.sh en el worktree. Pasa, así que recién ahora se lanzan los revisores.',
        [script],
        'round-1/checks.md',
      ),
      step(
        ['gate', 'review'],
        `Solo corren los revisores que eligió route (${lensList(happy)}), todos a la vez. Cada uno escribe su propio archivo.`,
        reviewersOf(happy),
        reviewFiles(1, happy),
      ),
      step(
        ['review', 'approve'],
        'Todos dieron VERDICT: PASS. El approver lee toda la carpeta del job y escribe APPROVE.',
        [approver],
        'decision.md',
      ),
      step(
        ['approve', 'merge'],
        'Con APPROVE, el script sincroniza origin/main en la rama y vuelve a correr el gate antes de mergear.',
        [script],
        'merge-checks.md',
      ),
      step(
        ['merge', 'bay-merged'],
        'El PR se mergea y el job termina en merged, sin esperar a nadie.',
        [script],
        'job.json',
        'auto_merge: true en config.json, así que el script mergea el PR por su cuenta.',
      ),
    ],
  },
  {
    id: 'reject',
    title: 'intake rechaza el issue',
    hint: 'intake: REJECT → rejected',
    summary: 'El pedido no es viable para el factory. intake lo rechaza en la puerta y el job termina sin gastar un solo agente más.',
    ...jobs.low,
    steps: [
      step(
        ['intake', 'bin-reject'],
        'intake responde REJECT. El orquestador comenta el motivo en el issue y el job termina en rejected.',
        [intake, orquestador],
        'intake.md',
        'intake escribió REJECT: el pedido no es viable, así que no entra a la línea.',
      ),
    ],
  },
  {
    id: 'needs-info',
    title: 'intake pide más información',
    hint: 'intake: NEEDS-INFO → vuelve a intake',
    summary: 'Falta información para especificar. El job se estaciona con una pregunta y vuelve a intake cuando alguien responde.',
    ...jobs.low,
    steps: [
      step(
        ['intake', 'bin-needs-info'],
        'intake responde NEEDS-INFO. El orquestador publica la pregunta en el issue y el job queda en needs-info.',
        [intake, orquestador],
        'intake.md',
        'intake escribió NEEDS-INFO: falta información para especificar el pedido.',
      ),
      step(
        ['bin-needs-info', 'intake'],
        'Una persona respondió en el issue. El job vuelve a intake, que lo lee otra vez con la respuesta.',
        [persona, intake],
        'intake.md',
        'La persona respondió: NEEDS-INFO es un bucle de espera, no un final.',
      ),
    ],
  },
  {
    id: 'gate-fail',
    title: 'El gate falla',
    hint: 'GATE: FAIL → vuelve a Build',
    summary: 'factory/checks.sh falla antes de revisar. El job vuelve al builder con el log y no se lanza ningún revisor.',
    ...gateFail,
    steps: [
      step(
        ['gate'],
        'El gate corre factory/checks.sh en el worktree del builder y los checks fallan. checks.md empieza con GATE: FAIL.',
        [script],
        'round-1/checks.md',
      ),
      step(
        ['gate', 'build'],
        'El job vuelve al builder con el log. No se gastan revisores, y el fallo cuenta como una de las max_rounds rondas.',
        [builderOf(gateFail)],
        'build.md',
        'GATE: FAIL: los checks no pasaron, así que el builder corrige antes de que alguien revise.',
      ),
    ],
  },
  {
    id: 'changes',
    title: 'Un revisor pide cambios',
    hint: 'CHANGES → vuelve a Build',
    summary: 'Un revisor responde CHANGES. Cuando llegan todos, el job vuelve al builder para una ronda nueva, hasta max_rounds.',
    ...changes,
    steps: [
      step(
        ['review'],
        `Corren los revisores que pidió el riesgo alto (${lensList(changes)}). El de seguridad responde VERDICT: CHANGES.`,
        reviewersOf(changes),
        reviewFiles(1, changes),
      ),
      step(
        ['review', 'build'],
        'La ronda cerró porque existen todos los archivos. El job vuelve al builder, que lee los hallazgos y arregla cada uno.',
        [builderOf(changes)],
        'build.md',
        'CHANGES en un revisor: otra ronda de build, gate y revisión, hasta max_rounds.',
      ),
    ],
  },
  {
    id: 'escalate',
    title: 'El approver escala',
    hint: 'ESCALATE → needs-human',
    summary: 'El approver no se anima a decidir solo. El PR queda listo y el job espera a una persona en needs-human.',
    ...escalate,
    steps: [
      step(
        ['approve', 'bay-needs-human'],
        'El approver escribe ESCALATE. El PR se marca listo, decision.md se publica en el PR y el issue recibe la etiqueta needs-human.',
        [approver, orquestador],
        'decision.md',
        'ESCALATE: el approver ve un riesgo que no debe cerrar solo, o se agotaron las rondas.',
      ),
    ],
  },
  {
    id: 'auto-merge-off',
    title: 'Sin auto_merge: el PR espera',
    hint: 'auto_merge: false → awaiting-merge',
    summary: 'Con auto_merge apagado el factory deja el PR listo pero no lo mergea. El job espera en awaiting-merge.',
    ...awaiting,
    steps: [
      step(
        ['merge', 'bay-awaiting-merge'],
        'El script sincroniza origin/main, corre el gate otra vez y marca el PR como listo con un comentario pidiendo el merge.',
        [script],
        'merge-checks.md',
        'auto_merge: false en config.json: el factory no mergea, el job queda en awaiting-merge.',
      ),
    ],
  },
  {
    id: 'human-merge',
    title: 'Una persona mergea el PR',
    hint: 'awaiting-merge → MERGE → merged',
    summary: 'Una persona mergea el PR en GitHub. La próxima corrida de /factory run mueve el job a merged.',
    ...humanMerge,
    steps: [
      step(
        ['bay-awaiting-merge', 'bay-merged'],
        'Una persona mergea el PR en GitHub. En la próxima corrida, /factory run ve el merge y pasa el job a merged sin lanzar agentes.',
        [persona, orquestador],
        'job.json',
        'El PR ya está mergeado en GitHub: el job puede pasar de awaiting-merge a merged.',
      ),
    ],
  },
  {
    id: 'human-rework',
    title: 'Una persona pide retrabajo',
    hint: 'needs-human → REWORK → Build',
    summary: 'Una persona revisa el PR en needs-human y pide cambios. El job vuelve al builder con sus comentarios.',
    ...rework,
    steps: [
      step(
        ['bay-needs-human', 'build'],
        'Una persona comenta el PR y corre /factory rework. Sus comentarios llegan al builder como review-human.md y él retoma el trabajo.',
        [persona, builderOf(rework)],
        'build.md',
        '/factory rework: el job sale de needs-human y vuelve a build con los comentarios de la persona.',
      ),
    ],
  },
  {
    id: 'pr-closed',
    title: 'Se cierra el PR',
    hint: 'needs-human → CLOSE → rejected',
    summary: 'Una persona descarta el trabajo y cierra el PR. El job termina en rejected.',
    ...closed,
    steps: [
      step(
        ['bay-needs-human', 'bay-rejected'],
        'Una persona decide que el trabajo no va y cierra el PR sin mergear. El job termina en rejected.',
        [persona, orquestador],
        'job.json',
        'PR cerrado sin merge: no hay nada que mergear, el job termina en rejected.',
      ),
    ],
  },
]);

/** Every step of every scenario, in order, tagged with where it comes from. */
export const TOUR_STEPS = deepFreeze(
  SCENARIOS.flatMap((scenario, scenarioIndex) =>
    scenario.steps.map((s, stepInScenario) => ({ ...s, scenarioId: scenario.id, scenarioIndex, stepInScenario })),
  ),
);
