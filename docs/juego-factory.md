# El juego del factory

Guía del juego que enseña cómo funciona el software factory de este repositorio.

## Qué es el juego

Es un quiz interactivo en la página `/game`. Recorre, una por una, las nueve estaciones del
factory v2: la cola de issues, `intake`, el ruteo, la especificación, la construcción, el
gate de checks, la revisión en paralelo, la aprobación y el merge.

Cada etapa muestra una animación hecha con [Remotion](https://www.remotion.dev/) (a través
de `@remotion/player`) que dibuja la planta completa, resalta la etapa actual y muestra sus
agentes, el modelo de cada uno y el archivo que escribe. Después de la animación aparece
una pregunta de opción múltiple sobre esa etapa (la revisión tiene dos).

Los datos del juego salen de `.claude/skills/factory/SKILL.md` (la versión que se ejecuta),
de los archivos de `.claude/agents/` y de `factory/config.json`. Los tests
(`test/engine.test.js` y `test/scenarios.test.js`) comparan los agentes, los modelos y el
ruteo del juego con esos archivos, así que el juego no puede quedar desactualizado sin que
falle la suite. El juego nunca lee jobs, el tablero, GitHub ni `config.json` mientras corre.

## La planta

El piso es una planta de producción isométrica:

- Un **muelle** de entrada (la cola de issues) y la puerta de `intake`, un **portón de
  clasificación** con tres salidas: `ACCEPT` sigue por la cinta, `NEEDS-INFO` va a un
  contenedor delante de la línea y `REJECT` a otro detrás.
- El ruteo es un **interruptor** con cuatro lámparas, una por lente (security, ux, ui y
  code): se encienden las lentes que el job rutea.
- La línea sigue por la especificación y la construcción hasta el **checkpoint** del gate.
  Si `checks.sh` falla (`GATE: FAIL`), un bucle vuelve a la construcción.
- La revisión tiene cuatro cápsulas; solo se encienden las de los revisores ruteados. Si
  alguien pide `CHANGES`, otro bucle vuelve a la construcción.
- Después del approver hay una **bifurcación** y cuatro **bahías** de salida: `merged`,
  `awaiting-merge`, `needs-human` y `rejected`.

Las cintas tienen rodillos que se mueven y los cables punteados de las ramas, los bucles y
las rutas de una persona avanzan con la animación.

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

Si solo quieres mirar, presiona **Ver el loop** en la pantalla inicial. El recorrido es un
loop guiado de diez escenarios, uno por cada camino condicional del factory, con unos 22
pasos de 10 segundos cada uno; al terminar el último vuelve al primero. En cada paso viaja un
paquete por la planta y el recuadro cuenta qué pasa y por qué, quién actúa (agente y
modelo, o `script`, `orquestador` y `persona`), qué archivo se escribe (`Escribe:`) y qué
condición eligió la rama (`Condición:`). El panel muestra `Loop guiado · Escenario s de N ·
Paso k de m`, con el título y el resumen del escenario. **Pausar** detiene el avance y
**Reanudar** lo continúa. Si haces clic en una estación (o la eliges con Tab y presionas
Enter o Espacio), el recorrido salta al paso del camino feliz que termina en ella y se
pausa. **Salir del loop** te devuelve a la pantalla inicial; el recorrido no suma ni resta
puntos.

Los diez escenarios son:

1. **Camino feliz con `auto_merge`** (`auto-merge-on`): el paquete recorre todas las
   estaciones, de la cola al merge. Con `auto_merge: true` el job termina solo en `merged`.
2. **`intake` rechaza** (`reject`): `REJECT`, el job termina en `rejected`.
3. **`intake` pide más información** (`needs-info`): `NEEDS-INFO`, el job espera una
   respuesta y vuelve a `intake`.
4. **El gate falla** (`gate-fail`): `GATE: FAIL`, el job vuelve al builder sin gastar
   revisores.
5. **Un revisor pide cambios** (`changes`): `CHANGES`, el job vuelve al builder, hasta
   `max_rounds` rondas.
6. **El approver escala** (`escalate`): `ESCALATE`, el job queda en `needs-human`.
7. **Sin `auto_merge`** (`auto-merge-off`): `auto_merge: false`, el PR queda listo y el job
   en `awaiting-merge`.
8. **Una persona mergea el PR** (`human-merge`): la persona mergea en GitHub y el job pasa
   de `awaiting-merge` a `merged`.
9. **Retrabajo** (`human-rework`): una persona corre `/factory rework` y el job vuelve a la
   construcción.
10. **Se cierra el PR** (`pr-closed`): una persona cierra el PR sin mergear (`PR cerrado`) y
    el job termina en `rejected`.

Cada escenario arranca en la estación donde se desvía; solo el primero parte de la cola.
Es una animación fija que se repite en cada vuelta; no lee los jobs reales de `board.json`.

Las cápsulas de los agentes se encienden con el color de su pulpo: por ejemplo, rojo
para `review-security` y azul para `review-code`.

El recorrido también tiene una melodía sintetizada en el navegador, sin archivos de
audio. Cada paso tiene su frase de 16 tiempos, que dura lo mismo que el paso (10
segundos). El sonido arranca al presionar
**Ver el loop**. El botón **Silenciar** lo apaga y **Activar sonido** lo vuelve a
encender. **Pausar** y **Salir del loop** también detienen la melodía.

## Etapas del factory

### 1. Cola de issues

- Agentes: ninguno; lo hace el orquestador (la sesión que ejecuta `/factory`).
- Archivo: `job.json`. Los issues abiertos con la etiqueta `factory` son la cola.

### 2. Intake

- Agente: `intake`, modelo `fable`.
- Archivo: `intake.md`, que empieza con `ACCEPT`, `NEEDS-INFO` o `REJECT`, con el riesgo y
  las superficies.

### 3. Ruteo

- Agentes: ninguno; lo hace el script `route`, que también crea el worktree.
- Archivo: `job.json`. Elige el modelo del builder y los revisores según `factory/config.json`.

### 4. Especificación

- Agente: `spec-writer`, modelo `opus`.
- Archivo: `spec.md`, con criterios de aceptación numerados (AC-1, AC-2, ...).

### 5. Construcción

- Agente: `builder`, `sonnet` (o `opus` si el riesgo es alto).
- Archivo: `build.md`, que empieza con `STATUS: READY`. Trabaja en la rama
  `factory/<job-id>` dentro de `.worktrees/<job-id>`, con un test por criterio.

### 6. Gate de checks

- Agentes: ninguno; lo hace el script `gate`.
- Archivo: `round-<n>/checks.md`. Corre `checks.sh`; con `GATE: FAIL` el job vuelve al
  builder y no se lanza ningún revisor.

### 7. Revisión en paralelo

- Agentes, solo los que eligió `route`, lanzados en un solo mensaje:
  - `review-security`, modelo `opus`, si toca seguridad
  - `review-ux`, modelo `sonnet`, si toca la UI
  - `review-ui`, modelo `haiku`, si toca la UI
  - `review-code`, `haiku` con riesgo bajo y `sonnet` en los demás casos; siempre corre
- Archivos: `round-<n>/review-<lente>.md`. Cada uno empieza con `VERDICT: PASS` o
  `VERDICT: CHANGES`. La ronda cierra cuando existen todos; con `CHANGES` el job vuelve al
  builder, hasta `max_rounds` rondas.

### 8. Aprobación

- Agente: `approver`, modelo `opus`.
- Archivo: `decision.md`, que empieza con `APPROVE` o `ESCALATE`. Con `ESCALATE` el job
  queda en `needs-human`.

### 9. Merge

- Agentes: ninguno; lo hace el script.
- Archivo: `merge-checks.md`. Con `auto_merge: true` el PR se mergea a `main` y el job termina en
  `merged`; con `auto_merge: false` queda en `awaiting-merge` hasta que una persona lo
  mergee. Desde `needs-human` una persona puede pedir retrabajo con `/factory rework` o
  cerrar el PR (`PR cerrado`), y el job termina en `rejected`.

## Puntuación

- Cada respuesta correcta suma **10 puntos**.
- Hay una pregunta por etapa, y dos en la revisión: 10 preguntas, así que el máximo es **100 puntos**.
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
