'use strict';

// Draws the + button's panel of workspaces (src/workspace-picker-panel.html) from what the main process
// sends through src/workspace-picker-panel-preload.js (see src/workspace-panel.js), and passes back the
// workspace picked. Search and XUNA's avatars come from src/workspace-picker.js, loaded before this.
// Typing searches; the arrow keys move through the rows and Enter opens the one marked; Escape closes.

(() => {
  const bridge = window.workspacePanel;
  const { searchItems, avatarPalette, initialsOf } = window.workspacePicker;
  const panel = document.querySelector('.panel');
  const input = document.getElementById('search');
  const list = document.getElementById('list');
  const footer = document.querySelector('.footer');
  const SVG = 'http://www.w3.org/2000/svg';

  let model = { items: [], dark: false };
  let rows = []; // the rows drawn, in order: { item, element }
  let marked = -1; // the row the arrow keys are on, or -1

  // fresh: the panel has just opened, so the search starts empty.
  bridge.onShow((next, fresh) => {
    model = next;
    document.documentElement.dataset.theme = next.dark ? 'dark' : 'light';
    if (fresh) input.value = '';
    render();
    if (fresh) input.focus();
  });

  function render() {
    const items = searchItems(model.items, input.value);
    const workspaces = items.filter((item) => item.kind === 'workspace');
    rows = [];
    list.replaceChildren();
    if (workspaces.length === 0) {
      const message = document.createElement('p');
      message.className = 'empty';
      message.textContent = input.value.trim() ? 'No workspaces found' : (items.find((item) => item.kind === 'note')?.label ?? 'No workspaces found');
      list.append(message);
    }
    let group = list;
    for (const item of workspaces.length ? items : []) {
      if (item.kind === 'header') {
        group = document.createElement('div');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', item.label);
        const heading = document.createElement('div');
        heading.className = 'heading';
        heading.setAttribute('aria-hidden', 'true');
        heading.textContent = item.label;
        group.append(heading);
        list.append(group);
      } else if (item.kind === 'workspace') {
        group.append(row(item, rows.length));
      }
    }
    // A note under the list: what to do when every tab is in use.
    const note = workspaces.length ? items.find((item) => item.kind === 'note') : null;
    footer.hidden = !note;
    footer.textContent = note?.label ?? '';
    mark(input.value.trim() ? rows.findIndex(({ item }) => item.enabled) : -1);
    requestAnimationFrame(() => bridge.resize(Math.ceil(panel.getBoundingClientRect().height)));
  }

  function row(item, index) {
    const element = document.createElement('div');
    element.className = item.current ? 'row current' : 'row';
    element.id = `row-${index}`;
    element.setAttribute('role', 'option');
    element.setAttribute('aria-selected', String(Boolean(item.current)));
    if (!item.enabled) element.setAttribute('aria-disabled', 'true');
    element.append(avatar(item));
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = item.label;
    label.title = item.label;
    element.append(label);
    for (const text of item.badges ?? []) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = text;
      element.append(badge);
    }
    if (item.shortcut) {
      const key = document.createElement('kbd');
      key.textContent = item.shortcut;
      key.title = 'Open in its tab';
      element.append(key);
    }
    if (item.current) element.append(tick());
    element.addEventListener('mousemove', () => mark(index, false));
    element.addEventListener('mousedown', (event) => event.preventDefault()); // the keyboard stays in the search
    element.addEventListener('click', () => choose(index));
    rows.push({ item, element });
    return element;
  }

  function avatar(item) {
    const circle = document.createElement('span');
    const initials = () => {
      circle.replaceChildren();
      circle.className = `avatar initials mesh-${avatarPalette(item.label)}`;
      circle.textContent = initialsOf(item.label);
    };
    circle.setAttribute('aria-hidden', 'true');
    if (item.avatarUrl) {
      circle.className = 'avatar';
      const image = document.createElement('img');
      image.alt = '';
      image.src = item.avatarUrl;
      image.addEventListener('error', initials); // a logo that won't load gives way to the initials
      circle.append(image);
    } else initials();
    return circle;
  }

  function tick() {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'tick');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', 'M20 6 9 17l-5-5');
    svg.append(path);
    return svg;
  }

  // scroll: false when the pointer marked the row, which is in view already.
  function mark(index, scroll = true) {
    rows[marked]?.element.classList.remove('highlighted');
    marked = index;
    const element = rows[marked]?.element;
    if (element) {
      element.classList.add('highlighted');
      input.setAttribute('aria-activedescendant', element.id);
      if (scroll) element.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  // step: 1 down, -1 up, skipping rows that can't be opened.
  function move(step) {
    if (rows.length === 0) return;
    let index = marked;
    for (let tries = 0; tries < rows.length; tries += 1) {
      index = index < 0 ? (step > 0 ? 0 : rows.length - 1) : (index + step + rows.length) % rows.length;
      if (rows[index].item.enabled) return mark(index);
    }
  }

  function choose(index) {
    const item = rows[index]?.item;
    if (item?.enabled) bridge.choose(item.id);
  }

  // Tab does nothing, so the keyboard stays in the search.
  const keys = { ArrowDown: () => move(1), ArrowUp: () => move(-1), Enter: () => choose(marked), Escape: () => bridge.close(), Tab: () => {} };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    const act = keys[event.key];
    if (!act) return;
    event.preventDefault();
    act();
  });
  document.querySelector('.close').addEventListener('click', () => bridge.close());
  // The clear margin round the panel belongs to the page under it, as far as the user can tell.
  document.body.addEventListener('mousedown', (event) => {
    if (!panel.contains(event.target)) bridge.close();
  });
})();
