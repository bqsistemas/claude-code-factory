// Game engine for the factory learning game. Plain JS with no React import, so it
// runs in Node (tests) and in the browser (bundled into public/game.js).
// Facts come from .claude/skills/factory/SKILL.md, .claude/agents/*.md and
// factory/config.json (the routing text; a test keeps it in sync).

export const POINTS_PER_CORRECT = 10;

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const STAGES = deepFreeze([
  {
    id: 'queue',
    title: 'Cola de issues',
    agents: [],
    output: 'job.json',
    summary:
      'Los issues abiertos con la etiqueta factory son la cola. El orquestador crea un job por issue con factory/bin/job y su estado queda en job.json.',
  },
  {
    id: 'intake',
    title: 'Intake',
    agents: [{ name: 'intake', model: 'fable' }],
    output: 'intake.md',
    summary:
      'intake lee el issue como dato citado y decide ACCEPT (quizá con el alcance recortado), NEEDS-INFO o REJECT. También anota el riesgo y las superficies que toca.',
  },
  {
    id: 'route',
    title: 'Ruteo',
    agents: [],
    output: 'job.json',
    summary:
      'El script route lee el riesgo y las superficies de intake.md, elige los modelos del builder y de los revisores según config.json, y crea el worktree del job.',
  },
  {
    id: 'spec',
    title: 'Especificación',
    agents: [{ name: 'spec-writer', model: 'opus' }],
    output: 'spec.md',
    summary:
      'El spec-writer convierte el issue, dentro del alcance que fijó intake, en spec.md con criterios de aceptación numerados y verificables (AC-1, AC-2, ...).',
  },
  {
    id: 'build',
    title: 'Construcción',
    agents: [{ name: 'builder', model: 'opus', routing: 'sonnet; opus si el riesgo es alto' }],
    output: 'build.md',
    summary:
      'El builder trabaja en la rama factory/<job-id> dentro de .worktrees/<job-id>, escribe un test por criterio, hace commit, abre el PR y deja build.md con STATUS: READY.',
  },
  {
    id: 'gate',
    title: 'Gate de checks',
    agents: [],
    output: 'round-<n>/checks.md',
    summary:
      'El script gate corre factory/checks.sh en el worktree. Con GATE: FAIL el job vuelve al builder y no se lanza ningún revisor.',
  },
  {
    id: 'review',
    title: 'Revisión en paralelo',
    agents: [
      { name: 'review-security', model: 'opus', routing: 'opus; solo si toca seguridad' },
      { name: 'review-ux', model: 'sonnet', routing: 'sonnet; solo si toca la UI' },
      { name: 'review-ui', model: 'sonnet', routing: 'haiku; solo si toca la UI' },
      { name: 'review-code', model: 'sonnet', routing: 'haiku si el riesgo es bajo; sonnet en los demás casos' },
    ],
    output: 'round-<n>/review-<lente>.md',
    summary:
      'Corren solo los revisores que eligió route, todos a la vez, y la ronda cierra cuando existen todos sus archivos. Cada uno empieza con VERDICT: PASS o VERDICT: CHANGES.',
  },
  {
    id: 'approve',
    title: 'Aprobación',
    agents: [{ name: 'approver', model: 'opus' }],
    output: 'decision.md',
    summary:
      'El approver lee toda la carpeta del job y decide. decision.md empieza con APPROVE o ESCALATE; con ESCALATE el job queda en needs-human.',
  },
  {
    id: 'merge',
    title: 'Merge',
    agents: [],
    output: 'merge-checks.md',
    summary:
      'Con APPROVE, el script sincroniza origin/main, vuelve a correr el gate y marca el PR como listo. Con auto_merge activo también lo mergea; si no, el job queda en awaiting-merge.',
  },
]);

export const QUESTIONS = deepFreeze([
  {
    stageId: 'queue',
    prompt: '¿Qué mete un pedido en la cola del factory?',
    options: [
      'Un commit directo a main',
      'Un issue abierto con la etiqueta factory',
      'Un archivo feature.md en la raíz del repo',
    ],
    correct: 1,
    explanation:
      'Los issues abiertos con la etiqueta factory son la cola. El orquestador crea un job por issue con factory/bin/job; solo ese script escribe job.json y board.json.',
  },
  {
    stageId: 'intake',
    prompt: 'intake responde NEEDS-INFO. ¿Qué pasa con el job?',
    options: [
      'Sigue a la especificación con lo que haya',
      'Se cierra el issue como rechazado',
      'Queda en espera con una pregunta en el issue y vuelve a intake cuando alguien responde',
      'El builder adivina lo que falta',
    ],
    correct: 2,
    explanation:
      'NEEDS-INFO estaciona el job en needs-info con una pregunta en el issue. Cuando alguien responde, el job vuelve a intake. REJECT, en cambio, termina el job en rejected.',
  },
  {
    stageId: 'route',
    prompt: '¿Quién elige los modelos del builder y de los revisores?',
    options: [
      'El script route, con el riesgo y las superficies de intake.md y la tabla de config.json',
      'El builder, según cuánto trabajo le parezca que hay',
      'El approver, al final',
      'Siempre se usa opus para todos',
    ],
    correct: 0,
    explanation:
      'route es un script, no un agente. Con riesgo alto el builder usa opus; con riesgo bajo, sonnet. Solo se lanzan los revisores que piden las superficies: security, ux y ui son opcionales y code siempre corre.',
  },
  {
    stageId: 'spec',
    prompt: '¿Qué entrega el spec-writer y con qué modelo corre?',
    options: [
      'spec.md con criterios de aceptación numerados, con opus',
      'build.md con el resultado de los tests, con sonnet',
      'spec.md con criterios de aceptación numerados, con sonnet',
      'decision.md con APPROVE o ESCALATE, con opus',
    ],
    correct: 0,
    explanation:
      'El spec-writer corre con opus y escribe spec.md: objetivo, alcance, diseño y criterios de aceptación numerados (AC-1, AC-2, ...) que después se testean.',
  },
  {
    stageId: 'build',
    prompt: '¿Dónde hace sus cambios el builder?',
    options: [
      'Directamente en main',
      'En factory/jobs/<job-id>/, junto a spec.md',
      'En la rama factory/<job-id>, dentro de .worktrees/<job-id>',
    ],
    correct: 2,
    explanation:
      'El builder trabaja en su propio worktree, .worktrees/<job-id>, sobre la rama factory/<job-id>. Nunca toca main; solo escribe build.md en la carpeta del job.',
  },
  {
    stageId: 'gate',
    prompt: 'factory/checks.sh falla en el gate (GATE: FAIL). ¿Qué pasa?',
    options: [
      'Se lanzan los revisores igual, para que opinen',
      'El job vuelve al builder con el log y no se lanza ningún revisor',
      'El approver decide si se ignora el fallo',
    ],
    correct: 1,
    explanation:
      'El gate corre antes de cualquier revisor. Con GATE: FAIL el job vuelve a build y el builder lee round-<n>/checks.md. Cada fallo gasta una de las max_rounds rondas.',
  },
  {
    stageId: 'review',
    prompt: '¿Qué revisores corren y cómo?',
    options: [
      'Los cuatro, uno detrás de otro',
      'Solo los que eligió route según el riesgo y las superficies, todos en paralelo',
      'Solo el que elige el builder',
      'Los cuatro con opus, en un único archivo',
    ],
    correct: 1,
    explanation:
      'review-code siempre corre; review-security, review-ux y review-ui solo si la superficie lo pide. Se lanzan en un solo mensaje y cada uno escribe su propio round-<n>/review-<lente>.md.',
  },
  {
    stageId: 'review',
    prompt: 'Un revisor responde VERDICT: CHANGES en la ronda 1. ¿Qué pasa?',
    options: [
      'Se hace merge igual, porque los otros dieron PASS',
      'El revisor corrige el código él mismo',
      'Cuando llegan todos los archivos, el job vuelve al builder, hasta max_rounds rondas',
      'El job se descarta',
    ],
    correct: 2,
    explanation:
      'WAIT FOR ALL: la ronda cierra solo cuando existen todos los archivos. Con algún CHANGES el job vuelve a build (y después al gate y a los revisores). Si fue la última ronda, pasa al approver, que va a escalar.',
  },
  {
    stageId: 'approve',
    prompt: '¿Con qué primera línea empieza decision.md y qué significa ESCALATE?',
    options: [
      'VERDICT: PASS; el PR se mergea',
      'APPROVE o ESCALATE; con ESCALATE el job queda en needs-human para que decida una persona',
      'STATUS: READY; el builder vuelve a construir',
    ],
    correct: 1,
    explanation:
      'El approver (opus) escribe APPROVE o ESCALATE. Con ESCALATE el PR se marca listo, la decisión se publica en el PR y el job espera en needs-human. VERDICT: es de los revisores y STATUS: READY, del builder.',
  },
  {
    stageId: 'merge',
    prompt: 'El approver dijo APPROVE y auto_merge es false. ¿Cómo termina el job?',
    options: [
      'Se mergea igual, porque APPROVE manda',
      'El PR queda listo con un comentario y el job pasa a awaiting-merge hasta que alguien lo mergee',
      'Vuelve a la cola',
      'Pasa a needs-human',
    ],
    correct: 1,
    explanation:
      'Con auto_merge: true el script mergea el PR y el job termina en merged. Con auto_merge: false marca el PR como listo, comenta y deja el job en awaiting-merge; la próxima corrida de /factory run lo pasa a merged cuando el PR ya se mergeó.',
  },
]);

export function createGame() {
  return { index: 0, score: 0, answers: [], finished: false };
}

export function currentQuestion(state) {
  if (state.finished) return null;
  return QUESTIONS[state.index] ?? null;
}

export function answer(state, choice) {
  const question = currentQuestion(state);
  if (!question) {
    throw new RangeError('The game is finished; start a new game to answer again.');
  }
  if (!Number.isInteger(choice) || choice < 0 || choice >= question.options.length) {
    throw new RangeError(
      `choice must be an integer from 0 to ${question.options.length - 1}, got ${String(choice)}`,
    );
  }
  const correct = choice === question.correct;
  const index = state.index + 1;
  return {
    index,
    score: state.score + (correct ? POINTS_PER_CORRECT : 0),
    answers: [...state.answers, { stageId: question.stageId, choice, correct }],
    finished: index >= QUESTIONS.length,
  };
}

export function maxScore() {
  return QUESTIONS.length * POINTS_PER_CORRECT;
}
