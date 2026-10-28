// The scenario picker of the guided loop: "Ver todos" plus one native radio per
// scenario, with a one-line hint each. Plain createElement (no JSX), like StaticOctopus.js.
import { createElement as h } from 'react';

import { SCENARIOS } from './scenarios.js';

const ALL_HINT = 'Los 10 escenarios, uno tras otro';

function Option({ id, title, hint, checked, onChange }) {
  return h(
    'label',
    null,
    h('input', { type: 'radio', name: 'scenario', value: id ?? '', checked, onChange: () => onChange(id) }),
    ' ',
    h('span', null, title),
    ' ',
    h('span', { className: 'game__picker-hint' }, hint),
  );
}

/**
 * @param {{ value: string|null, onChange: (id: string|null) => void }} props
 */
export function ScenarioPicker({ value, onChange }) {
  return h(
    'fieldset',
    { className: 'game__picker' },
    h('legend', null, 'Escenario'),
    h(Option, { id: null, title: 'Ver todos', hint: ALL_HINT, checked: value === null, onChange }),
    ...SCENARIOS.map((s) => h(Option, { key: s.id, id: s.id, title: s.title, hint: s.hint, checked: value === s.id, onChange })),
  );
}
