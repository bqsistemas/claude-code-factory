// Browser entry for /game: mounts the quiz UI and the Remotion Player into #game.
// Bundled to public/game.js with `npm run build:game`.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Player } from '@remotion/player';

import { FactoryLoop } from './FactoryLoop.jsx';
import {
  POINTS_PER_CORRECT,
  QUESTIONS,
  STAGES,
  answer,
  createGame,
  currentQuestion,
  maxScore,
} from './engine.js';

const DURATION = 90;
const stageIndexOf = (stageId) => STAGES.findIndex((s) => s.id === stageId);
const stageTitleOf = (stageId) => STAGES[stageIndexOf(stageId)].title;

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// Moves focus to an element after it renders, so keyboard and screen reader users
// land on the new content when the screen changes.
function useFocusOnMount() {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

function StagePlayer({ stageIndex }) {
  const reduced = prefersReducedMotion();
  return (
    <div className="game__player">
      <Player
        key={stageIndex}
        component={FactoryLoop}
        inputProps={{ stageIndex }}
        durationInFrames={DURATION}
        fps={30}
        compositionWidth={1280}
        compositionHeight={720}
        controls
        // The composition has no audio. Without shared audio tags the Player does
        // not load its silent data: mp3, which the default-src 'self' CSP blocks.
        numberOfSharedAudioTags={0}
        initiallyMuted
        // When true, the Player moves focus to its play button every time playback
        // starts or stops, pulling keyboard users away from the quiz.
        spaceKeyToPlayOrPause={false}
        autoPlay={!reduced}
        // Stay on the last frame, which shows the whole loop; frame 0 is still empty.
        moveToBeginningWhenEnded={false}
        initialFrame={reduced ? DURATION - 1 : 0}
        style={{ width: '100%' }}
      />
    </div>
  );
}

function Intro({ onStart }) {
  const startRef = useFocusOnMount();
  return (
    <section className="game__panel" aria-labelledby="game-title">
      <h1 id="game-title" className="game__title">El juego del factory</h1>
      <p className="game__text">
        Recorre las {STAGES.length} etapas del software factory de este repo: el orquestador, los
        siete agentes, sus archivos, la ronda de revisiones y la decisión final. Cada etapa
        tiene una animación y una pregunta. Cada respuesta correcta suma {POINTS_PER_CORRECT}{' '}
        puntos, hasta {maxScore()}.
      </p>
      <button type="button" className="game__button" ref={startRef} onClick={onStart}>
        Empezar
      </button>
    </section>
  );
}

function StageScreen({ question, number, result, onAnswer, onNext }) {
  const stageIndex = stageIndexOf(question.stageId);
  const stage = STAGES[stageIndex];
  const headingRef = useFocusOnMount();
  const nextRef = useRef(null);

  useEffect(() => {
    if (result) nextRef.current?.focus();
  }, [result]);

  return (
    <section className="game__panel" aria-labelledby="stage-title">
      <p className="game__progress">
        Pregunta {number} de {QUESTIONS.length}
      </p>
      <h1 id="stage-title" className="game__title" tabIndex={-1} ref={headingRef}>
        {stage.title}
      </h1>
      <StagePlayer stageIndex={stageIndex} />
      <p className="game__text">{stage.summary}</p>
      <h2 className="game__question" id="question-prompt">{question.prompt}</h2>
      <ul className="game__options" aria-labelledby="question-prompt">
        {question.options.map((option, i) => {
          let mark = '';
          if (result && i === question.correct) mark = ' game__option--correct';
          else if (result && i === result.choice) mark = ' game__option--wrong';
          return (
            <li key={option}>
              <button
                type="button"
                className={`game__option${mark}`}
                disabled={Boolean(result)}
                onClick={() => onAnswer(i)}
              >
                {option}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="game__feedback" aria-live="polite">
        {result && (
          <>
            <p className={result.correct ? 'game__verdict game__verdict--correct' : 'game__verdict game__verdict--wrong'}>
              {result.correct ? 'Correcto' : 'Incorrecto'}
              {' · '}+{result.correct ? POINTS_PER_CORRECT : 0} puntos
            </p>
            {!result.correct && (
              <p className="game__text">
                La respuesta correcta es: {question.options[question.correct]}
              </p>
            )}
            <p className="game__text">{question.explanation}</p>
          </>
        )}
      </div>
      {result && (
        <button type="button" className="game__button" ref={nextRef} onClick={onNext}>
          Siguiente
        </button>
      )}
    </section>
  );
}

function Finished({ state, onRestart }) {
  const headingRef = useFocusOnMount();
  return (
    <section className="game__panel" aria-labelledby="final-title">
      <h1 id="final-title" className="game__title" tabIndex={-1} ref={headingRef}>
        Fin del juego
      </h1>
      <p className="game__final-score">
        Puntaje final: {state.score} / {maxScore()}
      </p>
      <ul className="game__results">
        {state.answers.map((a, i) => (
          <li key={i} className={a.correct ? 'game__result game__result--correct' : 'game__result game__result--wrong'}>
            <span aria-hidden="true">{a.correct ? '[✓]' : '[✗]'}</span>{' '}
            {stageTitleOf(a.stageId)}
            <span className="visually-hidden">{a.correct ? ': correcta' : ': incorrecta'}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="game__button" onClick={onRestart}>
        Jugar de nuevo
      </button>
    </section>
  );
}

function Game() {
  const [state, setState] = useState(createGame);
  const [screen, setScreen] = useState('intro'); // intro | question | feedback | finished
  // The question just answered and the result, kept while feedback is shown,
  // because `state` has already moved on to the next question.
  const [last, setLast] = useState(null);

  useEffect(() => {
    const score = document.getElementById('score');
    if (score) score.textContent = String(state.score);
  }, [state.score]);

  if (screen === 'intro') {
    return <Intro onStart={() => setScreen('question')} />;
  }

  if (screen === 'finished') {
    return (
      <Finished
        state={state}
        onRestart={() => {
          setState(createGame());
          setLast(null);
          setScreen('question');
        }}
      />
    );
  }

  const question = screen === 'feedback' ? last.question : currentQuestion(state);
  return (
    <StageScreen
      key={state.index - (screen === 'feedback' ? 1 : 0)}
      question={question}
      number={QUESTIONS.indexOf(question) + 1}
      result={screen === 'feedback' ? last : null}
      onAnswer={(choice) => {
        const next = answer(state, choice);
        setLast({ question, choice, correct: next.answers.at(-1).correct });
        setState(next);
        setScreen('feedback');
      }}
      onNext={() => setScreen(state.finished ? 'finished' : 'question')}
    />
  );
}

createRoot(document.getElementById('game')).render(<Game />);
