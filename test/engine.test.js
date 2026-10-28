import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

import {
  POINTS_PER_CORRECT,
  STAGES,
  QUESTIONS,
  createGame,
  currentQuestion,
  answer,
  maxScore,
} from '../src/game/engine.js';

const agentsDir = new URL('../.claude/agents/', import.meta.url);

// Reads `name:` and `model:` from the YAML frontmatter of every agent file.
async function readAgents() {
  const files = (await readdir(agentsDir)).filter((f) => f.endsWith('.md'));
  const agents = [];
  for (const file of files) {
    const text = await readFile(new URL(file, agentsDir), 'utf8');
    const front = text.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(front, `${file} has frontmatter`);
    const name = front[1].match(/^name:\s*(.+)$/m)?.[1].trim();
    const model = front[1].match(/^model:\s*(.+)$/m)?.[1].trim();
    assert.ok(name && model, `${file} has name and model`);
    agents.push({ name, model });
  }
  return agents;
}

const key = ({ name, model }) => `${name}/${model}`;

// Answers every question correctly from a fresh game.
function playPerfectGame() {
  let state = createGame();
  while (!state.finished) {
    state = answer(state, currentQuestion(state).correct);
  }
  return state;
}

test('AC-2: STAGES follow the loop order and match the agents in .claude/agents/', async () => {
  assert.deepEqual(
    STAGES.map((s) => s.id),
    ['feature', 'spec', 'build', 'review', 'wait-for-all', 'approval', 'outcome'],
  );
  assert.ok(Object.isFrozen(STAGES), 'STAGES is frozen');

  const fromEngine = STAGES.flatMap((s) => s.agents).map(key).sort();
  const fromFiles = (await readAgents()).map(key).sort();
  assert.equal(fromFiles.length, 7, 'seven agent files');
  assert.deepEqual(fromEngine, fromFiles, 'engine agents equal .claude/agents/ frontmatter');

  for (const id of ['feature', 'wait-for-all', 'outcome']) {
    assert.deepEqual(STAGES.find((s) => s.id === id).agents, [], `${id} is orchestrator-only`);
  }
  for (const stage of STAGES) {
    assert.ok(stage.title.trim(), `${stage.id} title`);
    assert.ok(stage.output.trim(), `${stage.id} output`);
    assert.ok(stage.summary.trim(), `${stage.id} summary`);
  }
});

test('AC-3: every stage has a well-formed question', () => {
  const ids = new Set(STAGES.map((s) => s.id));
  assert.ok(Object.isFrozen(QUESTIONS), 'QUESTIONS is frozen');
  for (const id of ids) {
    assert.ok(QUESTIONS.some((q) => q.stageId === id), `stage ${id} has a question`);
  }
  for (const [i, q] of QUESTIONS.entries()) {
    assert.ok(ids.has(q.stageId), `question ${i} stageId ${q.stageId} is known`);
    assert.ok(q.options.length === 3 || q.options.length === 4, `question ${i} has 3 or 4 options`);
    for (const option of q.options) {
      assert.ok(typeof option === 'string' && option.trim(), `question ${i} option is non-empty`);
    }
    assert.ok(Number.isInteger(q.correct), `question ${i} correct is an integer`);
    assert.ok(q.correct >= 0 && q.correct < q.options.length, `question ${i} correct is a valid index`);
    assert.ok(q.prompt.trim(), `question ${i} prompt`);
    assert.ok(q.explanation.trim(), `question ${i} explanation`);
  }
  const order = STAGES.map((s) => s.id);
  const stageOrder = QUESTIONS.map((q) => order.indexOf(q.stageId));
  assert.deepEqual(stageOrder, [...stageOrder].sort((a, b) => a - b), 'questions in stage order');
});

test('AC-4: createGame and answer score correct and wrong choices without mutating input', () => {
  const start = createGame();
  assert.deepEqual(start, { index: 0, score: 0, answers: [], finished: false });
  assert.equal(POINTS_PER_CORRECT, 10);

  const snapshot = structuredClone(start);
  const q = currentQuestion(start);
  assert.equal(q, QUESTIONS[0]);

  const right = answer(start, q.correct);
  assert.deepEqual(start, snapshot, 'input state unchanged');
  assert.notEqual(right, start, 'returns a new state');
  assert.equal(right.score, start.score + 10);
  assert.equal(right.index, start.index + 1);
  assert.deepEqual(right.answers, [{ stageId: q.stageId, choice: q.correct, correct: true }]);

  const wrongChoice = (q.correct + 1) % q.options.length;
  const wrong = answer(start, wrongChoice);
  assert.deepEqual(start, snapshot, 'input state unchanged after wrong answer');
  assert.equal(wrong.score, start.score);
  assert.equal(wrong.index, start.index + 1);
  assert.deepEqual(wrong.answers, [{ stageId: q.stageId, choice: wrongChoice, correct: false }]);
  assert.equal(wrong.finished, false);

  for (const bad of [-1, q.options.length, 99, 0.5, 1.5, NaN, Infinity, '0', null, undefined]) {
    assert.throws(() => answer(start, bad), RangeError, `choice ${String(bad)} throws RangeError`);
  }
  assert.deepEqual(start, snapshot, 'input state unchanged after errors');
});

test('AC-5: a perfect game finishes with the maximum score and rejects further answers', () => {
  const state = playPerfectGame();
  assert.equal(state.finished, true);
  assert.equal(maxScore(), QUESTIONS.length * 10);
  assert.equal(state.score, maxScore());
  assert.equal(state.index, QUESTIONS.length);
  assert.equal(state.answers.length, QUESTIONS.length);
  assert.ok(state.answers.every((a) => a.correct));
  assert.equal(currentQuestion(state), null);
  assert.throws(() => answer(state, 0), RangeError);
});
