# El juego del factory

Guía del juego que enseña cómo funciona el software factory de este repositorio.

## Qué es el juego

Es un quiz interactivo en la página `/game`. Recorre, una por una, las siete etapas del
loop del factory: el pedido de feature, la especificación, la construcción, la revisión
en paralelo, la espera de todas las revisiones, la aprobación y el resultado final.

Cada etapa muestra una animación hecha con [Remotion](https://www.remotion.dev/) (a través
de `@remotion/player`) que dibuja el loop completo, resalta la etapa actual y muestra sus
agentes, el modelo de cada uno y el archivo que escribe. Después de la animación aparece
una pregunta de opción múltiple sobre esa etapa.

Los datos del juego salen de `.claude/skills/factory/SKILL.md` (la versión que se ejecuta)
y de los archivos de `.claude/agents/`. Un test (`test/engine.test.js`) compara los agentes
y modelos del juego con esos archivos, así que el juego no puede quedar desactualizado sin
que falle la suite.

## Cómo jugar

1. Abre `/game` y presiona **Empezar**.
2. Mira la animación de la etapa. El reproductor tiene controles para pausar, repetir o
   avanzar. Si tu sistema tiene activado "reducir movimiento", la animación no arranca
   sola y se muestra directamente el cuadro final.
3. Lee el resumen de la etapa y responde la pregunta eligiendo una opción.
4. Vas a ver **Correcto** o **Incorrecto**, los puntos que ganaste y una explicación.
   Si te equivocaste, también se muestra la respuesta correcta.
5. Presiona **Siguiente** para pasar a la etapa siguiente.
6. Al final aparece tu puntaje y la lista de etapas con aciertos y errores. Con
   **Jugar de nuevo** vuelves a empezar desde cero.

Todo se maneja con teclado: cada control es un botón.

Si solo quieres mirar, presiona **Ver el loop** en la pantalla inicial. El recorrido
avanza solo por las etapas, una cada 10 segundos, y al terminar la última vuelve a la
primera: la estación activa se ilumina, el panel explica la etapa y el recuadro muestra
los agentes que trabajan en ella. **Pausar** detiene el avance y **Reanudar** lo
continúa. Si haces clic en una estación (o la eliges con Tab y presionas Enter o
Espacio), el recorrido salta a ella y se pausa para que leas su explicación. **Salir del
loop** te devuelve a la pantalla inicial; el recorrido no suma ni resta puntos.

En el recorrido la planta está viva: varios paquetes de features avanzan por la línea a
la vez. Cada 2,5 segundos entra uno nuevo en la estación 1 y todos pasan de estación en
estación. En la bifurcación, los paquetes con `APPROVE` hacen merge a `main`: llegan a
la plataforma de `main` y se funden en ella. Los paquetes con `ESCALATE` quedan en la
cola de `needs-human`, apilados sobre su plataforma, hasta que una persona los revisa.
Entonces recorren la ruta punteada de la persona y llegan a `main` más tarde. Es una
animación fija que se repite en cada vuelta; no lee los jobs reales de `board.json`.

Las cápsulas de los agentes se encienden con el color de su pulpo: por ejemplo, rojo
para `review-security` y azul para `review-code`.

El recorrido también tiene una melodía sintetizada en el navegador, sin archivos de
audio. Cada etapa tiene su frase de 16 tiempos, que dura lo mismo que la etapa (10
segundos), y los paquetes entran al ritmo de la melodía. El sonido arranca al presionar
**Ver el loop**. El botón **Silenciar** lo apaga y **Activar sonido** lo vuelve a
encender. **Pausar** y **Salir del loop** también detienen la melodía.

## Etapas del factory

### 1. Pedido de feature

- Agentes: ninguno; lo hace el orquestador (la sesión que ejecuta `/factory`).
- Archivo: `feature.md` (además crea el job en `factory/board.json`, que solo escribe el
  orquestador).

### 2. Especificación

- Agente: `spec-writer`, modelo `opus`.
- Archivo: `spec.md`, con criterios de aceptación numerados (AC-1, AC-2, ...).

### 3. Construcción

- Agente: `builder`, modelo `opus`.
- Archivo: `build.md`, que empieza con `STATUS: READY`. Trabaja en la rama
  `factory/<job-id>` dentro de `.worktrees/<job-id>`, con un test por criterio.

### 4. Revisión en paralelo

- Agentes, lanzados en un solo mensaje:
  - `review-security`, modelo `opus`
  - `review-ux`, modelo `sonnet`
  - `review-ui`, modelo `sonnet`
  - `review-code`, modelo `sonnet`
- Archivos: `round-<n>/review-security.md`, `review-ux.md`, `review-ui.md` y
  `review-code.md`. Cada uno empieza con `VERDICT: PASS` o `VERDICT: CHANGES`.

### 5. Esperar a todos (WAIT FOR ALL)

- Agentes: ninguno; lo hace el orquestador.
- Archivo: `factory/board.json`. La ronda termina solo cuando existen los cuatro archivos
  de revisión. Si alguno dice `CHANGES`, el orquestador retoma al mismo `builder` para una
  nueva ronda, como máximo 2 rondas.

### 6. Aprobación

- Agente: `approver`, modelo `opus`.
- Archivo: `decision.md`, que empieza con `APPROVE` o `ESCALATE`.

### 7. Resultado

- Agentes: ninguno; lo hace el orquestador.
- Archivo: `factory/board.json`. Con `APPROVE` hace `git merge --no-ff` a `main`. Con
  `ESCALATE` el job queda en `needs-human` y una persona decide con
  `/factory approve <id>` o `/factory rework <id> <nota>`.
- En la planta, la línea hace una bifurcación después de Resultado: `APPROVE` va a
  merge a `main` y `ESCALATE` va a `needs-human`.

## Puntuación

- Cada respuesta correcta suma **10 puntos**.
- Hay una pregunta por etapa: 7 preguntas, así que el máximo es **70 puntos**.
- Una respuesta incorrecta suma 0 puntos y no resta: no hay penalización. El juego avanza
  igual y la explicación enseña la respuesta correcta.
- El puntaje se ve siempre arriba a la derecha. No se guarda: al recargar la página o al
  jugar de nuevo empieza en 0.

## Cómo ejecutarlo

1. Inicia el servidor:

   ```sh
   npm start
   ```

2. Abre <http://localhost:3000/game> en el navegador (o el puerto que indique `PORT`).

El bundle `public/game.js` ya está commiteado, así que no hace falta instalar nada para
jugar. Si editas algo dentro de `src/game/`, instala las dependencias de desarrollo y
vuelve a generar el bundle:

```sh
npm install
npm run build:game
```

Después corre `npm test` para comprobar que el juego sigue de acuerdo con los agentes.
