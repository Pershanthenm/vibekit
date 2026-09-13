// Updating the page without rebuilding it.
//
// Replacing innerHTML is the obvious way to show new state and the wrong one: every element is
// destroyed and remade, so the scroll position jumps, whatever had focus loses it, a half-typed
// filter empties and an open menu shuts — twice a second, while you are trying to read. On a phone
// it is unusable.
//
// This walks the live tree against a freshly rendered one and changes only what differs: the text
// of a counter, the class on a badge, a row that genuinely appeared. Everything else is left as it
// was — still focused, still scrolled, still selected.
//
// It is deliberately small. Children are matched by position, because these pages render lists in
// a stable order from sorted state; where that is not true an element carries `data-key` and is
// matched by that instead, so a row inserted in the middle moves the others rather than rewriting
// them. No imports: this is inlined into the page as source.

/** Attributes are most of the difference between two versions of the same element. */
function syncAttributes(current, next) {
  for (const attribute of Array.from(next.attributes)) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  for (const attribute of Array.from(current.attributes)) {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
}

/**
 * A form control holds state the markup does not: what you typed, what you ticked, where the caret
 * is. The rendered version is authoritative only when you are not using it — otherwise the page
 * would delete a word mid-sentence every time a build ticked over.
 */
function syncField(current, next) {
  if (typeof document !== 'undefined' && document.activeElement === current) return;
  if (current.type === 'checkbox' || current.type === 'radio') {
    const checked = next.hasAttribute('checked');
    if (current.checked !== checked) current.checked = checked;
    return;
  }
  const value = next.getAttribute('value');
  if (value !== null && current.value !== value) current.value = value;
}

const keyOf = (node) => (node.nodeType === 1 ? node.getAttribute('data-key') : null);

/**
 * Make `current` look like `next`, touching as little as possible.
 *
 * Returns the node that ended up in the tree: usually `current` itself, but a node whose type or
 * tag changed is replaced outright, and the caller needs to know where to carry on from.
 */
export function morph(current, next) {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
    current.replaceWith(next);
    return next;
  }
  // Text and comments carry nothing but their value.
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return current;
  }
  // An escape hatch for anything the page owns and the renderer does not — the lane console is
  // appended by the browser, and an update must never take it away mid-build.
  if (current.hasAttribute('data-keep')) return current;

  syncAttributes(current, next);

  if (current.tagName === 'INPUT' || current.tagName === 'TEXTAREA' || current.tagName === 'SELECT') {
    syncField(current, next);
    return current;
  }

  morphChildren(current, next);
  return current;
}

/**
 * Walk both child lists once, in order, reusing what matches and moving what has shifted.
 *
 * `cursor` is where the next child belongs. A reused node is moved there if it is not already,
 * which is what keeps a list in order when something is inserted in the middle; anything still
 * left when the new list runs out belonged to the old version and goes.
 */
export function morphChildren(current, next) {
  const keyed = new Map();
  for (const node of Array.from(current.childNodes)) {
    const key = keyOf(node);
    if (key) keyed.set(key, node);
  }

  let cursor = current.firstChild;
  for (const wanted of Array.from(next.childNodes)) {
    const key = keyOf(wanted);
    const match = key ? keyed.get(key) : (cursor && !keyOf(cursor) ? cursor : null);
    if (match && match.parentNode === current) {
      if (match !== cursor) current.insertBefore(match, cursor);
      const settled = morph(match, wanted);
      cursor = settled.nextSibling;
    } else {
      current.insertBefore(wanted, cursor);
    }
  }
  while (cursor) {
    const following = cursor.nextSibling;
    current.removeChild(cursor);
    cursor = following;
  }
}

/**
 * Render into a detached element and bring the live one up to date.
 *
 * The rendered string is compared first: on a page asking for state every two seconds, almost
 * every update contains nothing new, and the cheapest update is the one that never reaches the DOM
 * at all. Returns the string to compare against next time.
 */
export function apply(target, html, last) {
  if (html === last) return last;
  const staging = target.ownerDocument.createElement(target.tagName);
  staging.innerHTML = html;
  morphChildren(target, staging);
  return html;
}
