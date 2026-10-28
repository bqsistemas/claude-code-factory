// Game engine for the factory learning game. Plain JS with no React import, so it
// runs in Node (tests) and in the browser (bundled into public/game.js).
// Facts come from .claude/skills/factory/SKILL.md and .claude/agents/*.md.

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
    id: 'feature',
    title: 'Pedido de feature',
    agents: [],
    output: 'feature.md',
    summary:
      'El orquestador recibe /factory <feature>, crea el job en factory/board.json y escribe el pedido tal cual en feature.md.',
  },
  {
    id: 'spec',
    title: 'Especificación',
    agents: [{ name: 'spec-writer', model: 'opus' }],
    output: 'spec.md',
    summary:
      'El spec-writer convierte feature.md en spec.md, con criterios de aceptación numerados y verificables (AC-1, AC-2, ...).',
  },
  {
    id: 'build',
    title: 'Construcción',
    agents: [{ name: 'builder', model: 'opus' }],
    output: 'build.md',
    summary:
      'El builder trabaja en la rama factory/<job-id> dentro de .worktrees/<job-id>, escribe un test por criterio, hace commit y deja build.md con STATUS: READY.',
  },
  {
    id: 'review',
    title: 'Revisión en paralelo',
    agents: [
      { name: 'review-security', model: 'opus' },
      { name: 'review-ux', model: 'sonnet' },
      { name: 'review-ui', model: 'sonnet' },
      { name: 'review-code', model: 'sonnet' },
    ],
    output: 'round-<n>/review-*.md',
    summary:
      'Cuatro revisores corren en paralelo. Cada uno escribe su archivo en la carpeta de la ronda, empezando con VERDICT: PASS o VERDICT: CHANGES.',
  },
  {
    id: 'wait-for-all',
    title: 'Esperar a todos',
    agents: [],
    output: 'board.json',
    summary:
      'La ronda termina solo cuando existen los cuatro archivos de revisión. Si alguno pide CHANGES, el orquestador retoma al builder (máximo 2 rondas).',
  },
  {
    id: 'approval',
    title: 'Aprobación',
    agents: [{ name: 'approver', model: 'opus' }],
    output: 'decision.md',
    summary:
      'El approver lee toda la carpeta del job y decide. decision.md empieza con APPROVE o ESCALATE.',
  },
  {
    id: 'outcome',
    title: 'Resultado',
    agents: [],
    output: 'board.json',
    summary:
      'Con APPROVE, el orquestador hace merge --no-ff a main. Con ESCALATE, el job queda en needs-human y decide una persona.',
  },
]);

export const QUESTIONS = deepFreeze([
  {
    stageId: 'feature',
    prompt: '¿Quién escribe feature.md y es el único que escribe factory/board.json?',
    options: ['El spec-writer', 'El orquestador', 'El builder', 'El approver'],
    correct: 1,
    explanation:
      'El orquestador (la sesión que ejecuta la skill /factory) escribe feature.md con el pedido textual y es el único que escribe board.json.',
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
      'El builder (opus) trabaja en su propio worktree, .worktrees/<job-id>, sobre la rama factory/<job-id>. Nunca toca main; solo escribe build.md en la carpeta del job.',
  },
  {
    stageId: 'review',
    prompt: '¿Cómo se ejecutan los cuatro revisores?',
    options: [
      'Uno detrás de otro: primero security, después ux, ui y code',
      'En paralelo, lanzados en un solo mensaje',
      'Solo corre el revisor que elige el builder',
      'Los cuatro usan opus y comparten un único archivo',
    ],
    correct: 1,
    explanation:
      'review-security (opus), review-ux, review-ui y review-code (sonnet) se lanzan en un solo mensaje y corren en paralelo. Cada uno escribe su propio review-<lente>.md.',
  },
  {
    stageId: 'wait-for-all',
    prompt: 'Si un revisor responde VERDICT: CHANGES en la ronda 1, ¿qué pasa?',
    options: [
      'Se hace merge igual, porque los otros tres dieron PASS',
      'El revisor corrige el código él mismo',
      'Cuando llegan las cuatro revisiones, el orquestador retoma al builder para una nueva ronda',
      'El job se descarta',
    ],
    correct: 2,
    explanation:
      'WAIT FOR ALL: la ronda cierra solo cuando existen los cuatro archivos. Con algún CHANGES se retoma al mismo builder, como máximo 2 rondas; si se llega al máximo, el approver va a escalar.',
  },
  {
    stageId: 'approval',
    prompt: '¿Con qué primera línea empieza decision.md?',
    options: ['VERDICT: PASS o VERDICT: CHANGES', 'STATUS: READY', 'APPROVE o ESCALATE'],
    correct: 2,
    explanation:
      'El approver (opus) escribe decision.md y su primera línea es APPROVE o ESCALATE. VERDICT: es de los revisores y STATUS: READY es del builder.',
  },
  {
    stageId: 'outcome',
    prompt: 'Si el approver decide ESCALATE, ¿cómo sigue el job?',
    options: [
      'Se hace merge a main automáticamente',
      'Queda en needs-human: una persona usa /factory approve <id> o /factory rework <id> <nota>',
      'El builder reintenta sin límite de rondas',
    ],
    correct: 1,
    explanation:
      'ESCALATE deja el job en needs-human. Una persona lo aprueba con /factory approve o pide cambios con /factory rework. Con APPROVE, el orquestador hace merge --no-ff a main.',
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
