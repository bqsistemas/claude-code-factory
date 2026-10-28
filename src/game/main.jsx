// Browser entry for /game: mounts the quiz UI and the Remotion Player into #game.
// Bundled to public/game.js with `npm run build:game`.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Player } from '@remotion/player';

import { AVATARS } from '../../factory/avatars.js';
import { FactoryLoop } from './FactoryLoop.jsx';
import { StaticOctopus } from './StaticOctopus.js';
import { HUD_HEIGHT, WIDE, captionContent, splitColumns } from './layout.js';
import { compositionSize } from './scene.js';
import {
  POINTS_PER_CORRECT,
  QUESTIONS,
  STAGES,
  answer,
  createGame,
  currentQuestion,
  maxScore,
} from './engine.js';
import { phraseFor } from './melody.js';
import { SCENARIOS, TOUR_STEPS } from './scenarios.js';
import { schedulePhrase } from './sound.js';
import { SELECT_FRAME, TOUR_STEP_MS, createTour, nextStep, selectStep, stepForStation, togglePlaying } from './tour.js';

// At most 5 seconds (WCAG 2.2.2): the quiz Player has no pause control.
const DURATION = 120;
// The tour Player plays one whole step at 30 fps; "Pausar" pauses it (WCAG 2.2.2).
const TOUR_FRAMES = (TOUR_STEP_MS * 30) / 1000;
// The tour Player loops and runs one second longer than a step, so the step timer
// always restarts it before it wraps and it never reaches an end. At its end a
// non-looping Player stops itself; when that stop met the step timer's play(),
// the Player stayed flagged "playing" with its frame loop stopped and froze the
// tour for good. Only pause() (Pausar, a station select) stops this one.
const TOUR_PLAYER_FRAMES = TOUR_FRAMES + 30;
// Melody gain: quiet, well under sound.js's 0.2 cap.
const VOLUME = 0.06;
const stageIndexOf = (stageId) => STAGES.findIndex((s) => s.id === stageId);
const stageTitleOf = (stageId) => STAGES[stageIndexOf(stageId)].title;

// Creates the tour's AudioContext, or resumes a suspended one. Call it only
// inside a click handler: browsers (Safari above all) keep audio started
// anywhere else suspended. Returns null where Web Audio is missing.
function openAudio(context) {
  try {
    if (context && context.state !== 'closed') {
      if (context.state === 'suspended') context.resume()?.catch?.(() => {});
      return context;
    }
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    return AudioContextClass ? new AudioContextClass() : null;
  } catch {
    return null;
  }
}

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

// The Player's composition size and layout mode. On wide screens (64rem and up) the
// scene is the right column, so the composition is that column's real size, measured
// with a ResizeObserver, and the plant is centred in it. Below 64rem the scene is the
// fixed full-viewport layer and the composition is the viewport. Either way the
// composition keeps the element's aspect ratio, so the Player never letterboxes.
function useScene() {
  const ref = useRef(null);
  const [scene, setScene] = useState(() => {
    const split = window.innerWidth >= WIDE;
    return {
      split,
      ...(split
        ? compositionSize(splitColumns(window.innerWidth).scene, window.innerHeight - HUD_HEIGHT)
        : compositionSize(window.innerWidth, window.innerHeight)),
    };
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const split = window.innerWidth >= WIDE;
      const box = element.getBoundingClientRect();
      const next = { split, ...compositionSize(box.width, box.height) };
      setScene((prev) => (prev.split === next.split && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return { ref, ...scene };
}

function StagePlayer({ stageIndex }) {
  const reduced = prefersReducedMotion();
  const { ref, width, height, split } = useScene();
  return (
    <div className="game__scene" ref={ref}>
      <Player
        key={stageIndex}
        component={FactoryLoop}
        inputProps={{ stageIndex, split }}
        durationInFrames={DURATION}
        fps={30}
        compositionWidth={width}
        compositionHeight={height}
        // The composition has no audio. Without shared audio tags the Player does
        // not load its silent data: mp3, which the default-src 'self' CSP blocks.
        numberOfSharedAudioTags={0}
        initiallyMuted
        // When true, the Player moves focus to its play button every time playback
        // starts or stops, pulling keyboard users away from the quiz.
        spaceKeyToPlayOrPause={false}
        // No playback UI: the animation is short (4s), plays once, and stops on its
        // last frame, which shows the whole scene.
        autoPlay={!reduced}
        moveToBeginningWhenEnded={false}
        initialFrame={reduced ? DURATION - 1 : 0}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}

// Hairline icons for the tour controls (24x24, stroked with currentColor).
const ICONS = {
  pause: <path d="M8 5v14M16 5v14" />,
  play: <path d="M8 5l11 7-11 7z" />,
  sound: <path d="M4 9v6h4l5 4V5L8 9zM16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11" />,
  muted: <path d="M4 9v6h4l5 4V5L8 9zM17 9.5l4 5M21 9.5l-4 5" />,
  exit: <path d="M6 6l12 12M18 6L6 18" />,
};

// A small square icon button. The accessible name flips with the state ("Pausar" /
// "Reanudar"), so there is no aria-pressed; `active` only styles the state.
function IconButton({ label, icon, onClick, active = false }) {
  return (
    <button type="button" className={active ? 'game__icon-button game__icon-button--on' : 'game__icon-button'} aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {icon}
      </svg>
    </button>
  );
}

function Intro({ onStart, onTour }) {
  const startRef = useFocusOnMount();
  return (
    <section className="game__panel" aria-labelledby="game-title">
      <h1 id="game-title" className="game__title">El juego del factory</h1>
      <p className="game__text">
        Recorre las {STAGES.length} etapas del software factory de este repo: la cola de issues, los
        ocho agentes, sus archivos, el gate, las revisiones y la decisión final. Cada etapa
        tiene una animación y al menos una pregunta. Cada respuesta correcta suma {POINTS_PER_CORRECT}{' '}
        puntos, hasta {maxScore()}.
      </p>
      <button type="button" className="game__button" ref={startRef} onClick={onStart}>
        Empezar
      </button>{' '}
      <button type="button" className="game__button" onClick={onTour}>
        Ver el loop
      </button>
    </section>
  );
}

// The caption's content in the text card: the narration, the agents with their model,
// the file the step writes and the condition that picked the branch. It is HTML, drawn
// once, so it is the same in the left column (64rem and wider) and in the phone dock.
function DockCaption({ item }) {
  const { text, chips, file, condition } = captionContent(item);
  return (
    <div className="game__caption">
      {text && <p className="game__caption-text">{text}</p>}
      <div className="game__caption-chips">
        {chips.length === 0 ? (
          <span>Sin agentes: lo hace el orquestador o un script</span>
        ) : (
          chips.map((chip, i) => {
            const agent = Object.hasOwn(AVATARS, chip.name);
            return (
              <span key={`${chip.name}-${i}`} className={agent ? 'game__chip game__chip--agent' : 'game__chip'}>
                {agent && <StaticOctopus name={chip.name} size={24} />}
                {chip.model ? `${chip.name} · ${chip.model}` : chip.name}
              </span>
            );
          })
        )}
      </div>
      <p className="game__caption-line">
        Escribe: <span className="game__caption-file">{file}</span>
      </p>
      {condition && (
        <p className="game__caption-line">
          Condición: <span className="game__caption-condition">{condition}</span>
        </p>
      )}
    </div>
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
      <StagePlayer stageIndex={stageIndex} />
      <div className="game__stage">
        <div className="game__media">
          <p className="game__progress">
            Pregunta {number} de {QUESTIONS.length}
          </p>
          <h1 id="stage-title" className="game__title" tabIndex={-1} ref={headingRef}>
            {stage.title}
          </h1>
          <p className="game__text">{stage.summary}</p>
          <DockCaption item={stage} />
        </div>
        <div className="game__quiz">
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
        </div>
      </div>
    </section>
  );
}

// The guided loop tour: the plant plays one narrated scenario step at a time on its
// own, wrapping after the last one, with a melody in time. Clicking (or Enter/Space
// on) a station jumps to its step on the happy path and pauses. The tour never
// answers a question and never changes the score. `audio` is the AudioContext
// the "Ver el loop" click created (or null); the tour closes it on the way out.
function TourScreen({ onExit, audio }) {
  const [tour, setTour] = useState(createTour);
  const [soundOn, setSoundOn] = useState(true);
  const headingRef = useFocusOnMount();
  const playerRef = useRef(null);
  const audioRef = useRef(audio);
  const phraseRef = useRef(null);
  const soundRef = useRef(true);
  // The step on screen and when it started playing, for unmuting mid-step.
  const stepRef = useRef({ index: 0, playing: false, startedAt: 0 });
  const reduced = prefersReducedMotion();
  const { ref: sceneRef, width, height, split } = useScene();
  const step = TOUR_STEPS[tour.index];
  const scenario = SCENARIOS[step.scenarioIndex];

  const stopPhrase = useCallback(() => {
    phraseRef.current?.stop();
    phraseRef.current = null;
  }, []);

  // Plays step `index`'s phrase as if it started `elapsedMs` ago, so it stays on
  // the beat; notes already past are skipped.
  const startPhrase = useCallback(
    (index, elapsedMs = 0) => {
      stopPhrase();
      const context = audioRef.current;
      if (!soundRef.current || !context || context.state === 'closed') return;
      const notes = phraseFor(index).filter((note) => note.startMs >= elapsedMs);
      phraseRef.current = schedulePhrase(context, notes, { when: context.currentTime - elapsedMs / 1000, volume: VOLUME });
    },
    [stopPhrase],
  );

  // One rule for every step that starts playing (entering the tour, auto-advance,
  // "Reanudar"): the step timer, the Player from frame 0, and the step's phrase
  // start together. "Pausar" pauses the Player and stops the phrase. The Player
  // stays mounted across steps, so a focused station keeps focus.
  useEffect(() => {
    const player = playerRef.current;
    stepRef.current = { index: tour.index, playing: tour.playing, startedAt: performance.now() };
    if (!tour.playing) {
      player?.pause();
      stopPhrase();
      return undefined;
    }
    if (reduced) {
      player?.seekTo(TOUR_FRAMES - 1);
    } else {
      player?.seekTo(0);
      player?.play();
    }
    startPhrase(tour.index);
    const timer = setTimeout(() => setTour((t) => nextStep(t)), TOUR_STEP_MS);
    return () => {
      clearTimeout(timer);
      stopPhrase();
    };
  }, [tour.index, tour.playing, reduced, startPhrase, stopPhrase]);

  // Leaving the tour ("Salir del loop") silences it and releases the audio device.
  useEffect(
    () => () => {
      phraseRef.current?.stop();
      audioRef.current?.close?.()?.catch?.(() => {});
    },
    [],
  );

  // A selected station shows fully lit, paused, without its phrase.
  const onSelect = useCallback(
    (i) => {
      setTour((t) => selectStep(t, stepForStation(i)));
      const player = playerRef.current;
      player?.pause();
      player?.seekTo(reduced ? TOUR_FRAMES - 1 : SELECT_FRAME);
      stopPhrase();
    },
    [reduced, stopPhrase],
  );

  const onToggleSound = () => {
    if (soundRef.current) {
      soundRef.current = false;
      setSoundOn(false);
      stopPhrase();
      return;
    }
    audioRef.current = openAudio(audioRef.current);
    soundRef.current = true;
    setSoundOn(true);
    const step = stepRef.current;
    if (step.playing) startPhrase(step.index, performance.now() - step.startedAt);
  };

  return (
    <section className="game__panel" aria-labelledby="tour-title">
      <div className="game__scene" ref={sceneRef}>
        <Player
          ref={playerRef}
          component={FactoryLoop}
          inputProps={{ stepIndex: tour.index, onSelect, pipeline: true, split }}
          durationInFrames={TOUR_PLAYER_FRAMES}
          loop
          fps={30}
          compositionWidth={width}
          compositionHeight={height}
          numberOfSharedAudioTags={0}
          initiallyMuted
          spaceKeyToPlayOrPause={false}
          initialFrame={reduced ? TOUR_FRAMES - 1 : 0}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
      <div className="game__stage">
        <div className="game__media" aria-live="polite">
          <p className="game__progress">
            Loop guiado · Escenario {step.scenarioIndex + 1} de {SCENARIOS.length} · Paso{' '}
            {step.stepInScenario + 1} de {scenario.steps.length}
          </p>
          <h1 id="tour-title" className="game__title" tabIndex={-1} ref={headingRef}>
            {scenario.title}
          </h1>
          <p className="game__text">{scenario.summary}</p>
          <DockCaption item={step} />
        </div>
        <div className="game__controls">
          <IconButton
            label={tour.playing ? 'Pausar' : 'Reanudar'}
            active={!tour.playing}
            onClick={() => setTour((t) => togglePlaying(t))}
            icon={tour.playing ? ICONS.pause : ICONS.play}
          />
          <IconButton
            label={soundOn ? 'Silenciar' : 'Activar sonido'}
            active={!soundOn}
            onClick={onToggleSound}
            icon={soundOn ? ICONS.sound : ICONS.muted}
          />
          <IconButton label="Salir del loop" onClick={onExit} icon={ICONS.exit} />
        </div>
      </div>
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
  const [screen, setScreen] = useState('intro'); // intro | tour | question | feedback | finished
  // The question just answered and the result, kept while feedback is shown,
  // because `state` has already moved on to the next question.
  const [last, setLast] = useState(null);
  // The tour's AudioContext, created by the "Ver el loop" click itself.
  const [tourAudio, setTourAudio] = useState(null);

  useEffect(() => {
    const score = document.getElementById('score');
    if (score) score.textContent = String(state.score);
  }, [state.score]);

  if (screen === 'intro') {
    return (
      <Intro
        onStart={() => setScreen('question')}
        onTour={() => {
          setTourAudio(openAudio(null));
          setScreen('tour');
        }}
      />
    );
  }

  if (screen === 'tour') {
    return (
      <TourScreen
        audio={tourAudio}
        onExit={() => {
          setTourAudio(null);
          setScreen('intro');
        }}
      />
    );
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
