// What must survive an update, and what must change.
//
// The page updates twice a second while you read it. The point of morphing rather than re-rendering
// is that an update is invisible unless something actually changed — so these tests are mostly
// about identity: is this the *same* element as before, or a new one wearing its clothes? A new one
// loses focus, scroll, selection and anything typed into it.
//
// There is no DOM in Node and this project has no dependencies, so these run against a stub
// implementing only what morph touches. That is a real limit: it proves the matching and the
// patching, not that Chrome agrees. The browser is checked against the served page by hand.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, morph, morphChildren } from '../src/dom-morph.js';

// --- The smallest DOM morph can work against ---

class Node {
  constructor(nodeType, nodeName) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.childNodes = [];
    this.parentNode = null;
  }

  get firstChild() { return this.childNodes[0] ?? null; }

  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  insertBefore(node, before) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const at = before ? this.childNodes.indexOf(before) : -1;
    this.childNodes.splice(at === -1 ? this.childNodes.length : at, 0, node);
    node.parentNode = this;
    return node;
  }

  appendChild(node) { return this.insertBefore(node, null); }

  removeChild(node) {
    const at = this.childNodes.indexOf(node);
    if (at !== -1) this.childNodes.splice(at, 1);
    node.parentNode = null;
    return node;
  }

  replaceWith(node) {
    if (!this.parentNode) return;
    this.parentNode.insertBefore(node, this);
    this.parentNode.removeChild(this);
  }
}

class Text extends Node {
  constructor(value) { super(3, '#text'); this.nodeValue = value; }
  get text() { return this.nodeValue; }
}

class Element extends Node {
  constructor(tagName) {
    super(1, tagName.toUpperCase());
    this.tagName = tagName.toUpperCase();
    this.attrs = new Map();
    this.ownerDocument = globalThis.document;
  }

  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  removeAttribute(name) { this.attrs.delete(name); }
  hasAttribute(name) { return this.attrs.has(name); }

  get text() { return this.childNodes.map((node) => node.text).join(''); }
}

globalThis.document = { activeElement: null, createElement: (tag) => new Element(tag) };

const element = (tag, attributes = {}, children = []) => {
  const node = new Element(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  for (const child of children) node.appendChild(typeof child === 'string' ? new Text(child) : child);
  return node;
};

// --- What survives ---

test('an element that has not changed is the same element afterwards', () => {
  const live = element('div', { class: 'card' }, [element('span', { id: 'count' }, ['3'])]);
  const span = live.firstChild;

  morph(live, element('div', { class: 'card' }, [element('span', { id: 'count' }, ['3'])]));

  assert.equal(live.firstChild, span, 'the same node, not a replacement wearing its attributes');
});

test('only the text that changed is rewritten', () => {
  const live = element('div', {}, [element('b', {}, ['6/17']), element('i', {}, ['steady'])]);
  const [bold, italic] = live.childNodes;
  const italicText = italic.firstChild;

  morph(live, element('div', {}, [element('b', {}, ['7/17']), element('i', {}, ['steady'])]));

  assert.equal(bold.text, '7/17', 'the counter moved');
  assert.equal(live.childNodes[0], bold, 'in the element that was already there');
  assert.equal(italic.firstChild, italicText, 'and the text that did not change was not touched');
});

test('what someone is typing is never overwritten', () => {
  const input = element('input', { value: '' });
  input.value = 'devi';
  const live = element('div', {}, [input]);
  globalThis.document.activeElement = input;

  morph(live, element('div', {}, [element('input', { value: '' })]));
  assert.equal(input.value, 'devi', 'the field still holds what was typed into it');

  // Once it is no longer in use, the rendered value is authoritative again.
  globalThis.document.activeElement = null;
  morph(live, element('div', {}, [element('input', { value: 'reset' })]));
  assert.equal(input.value, 'reset');
});

test('a box someone just ticked stays ticked', () => {
  const box = element('input', { type: 'checkbox' });
  box.type = 'checkbox';
  box.checked = true;
  const live = element('div', {}, [box]);
  globalThis.document.activeElement = box;

  morph(live, element('div', {}, [element('input', { type: 'checkbox' })]));
  assert.equal(box.checked, true, 'a selection survives the next update');
  globalThis.document.activeElement = null;
});

test('anything marked data-keep is left entirely alone', () => {
  const lane = element('section', { 'data-keep': 'true' }, [element('pre', {}, ['installing…'])]);
  const live = element('div', {}, [lane]);

  morph(live, element('div', {}, [element('section', { 'data-keep': 'true' }, [])]));

  assert.equal(lane.text, 'installing…', "output the browser appended is not the renderer's to remove");
});

// --- What changes ---

test('a row added in the middle moves the others rather than rewriting them', () => {
  const live = element('ul', {}, [
    element('li', { 'data-key': 'a' }, ['first']),
    element('li', { 'data-key': 'c' }, ['third']),
  ]);
  const [first, third] = live.childNodes;

  morphChildren(live, element('ul', {}, [
    element('li', { 'data-key': 'a' }, ['first']),
    element('li', { 'data-key': 'b' }, ['second']),
    element('li', { 'data-key': 'c' }, ['third']),
  ]));

  assert.deepEqual(live.childNodes.map((node) => node.text), ['first', 'second', 'third'], 'in the right order');
  assert.equal(live.childNodes[0], first, 'the first row is the one that was already there');
  assert.equal(live.childNodes[2], third, 'and so is the last');
});

test('a row that is gone is removed', () => {
  const live = element('ul', {}, [
    element('li', { 'data-key': 'a' }, ['first']),
    element('li', { 'data-key': 'b' }, ['second']),
  ]);

  morphChildren(live, element('ul', {}, [element('li', { 'data-key': 'b' }, ['second'])]));

  assert.equal(live.childNodes.length, 1);
  assert.equal(live.firstChild.text, 'second');
});

test('an element whose tag changed is replaced outright', () => {
  const live = element('div', {}, [element('span', {}, ['x'])]);
  const span = live.firstChild;

  morph(live, element('div', {}, [element('b', {}, ['x'])]));

  assert.equal(live.firstChild.nodeName, 'B');
  assert.notEqual(live.firstChild, span);
});

test('attributes are added, changed and removed', () => {
  const live = element('span', { class: 'badge neutral', title: 'gone' }, ['Not run']);

  morph(live, element('span', { class: 'badge ok', 'data-x': '1' }, ['Passing']));

  assert.equal(live.getAttribute('class'), 'badge ok');
  assert.equal(live.getAttribute('data-x'), '1');
  assert.equal(live.getAttribute('title'), null, 'an attribute the new version does not have is dropped');
});

// --- The cheap path ---

test('identical markup does not touch the tree at all', () => {
  const live = element('section', {}, [element('p', {}, ['same'])]);
  const paragraph = live.firstChild;
  const html = '<p>same</p>';

  // The stub cannot parse HTML, so a repeat call with the same string must never reach it.
  const build = globalThis.document.createElement;
  globalThis.document.createElement = () => { throw new Error('the DOM was rebuilt for an update with nothing in it'); };
  const last = apply(live, html, html);

  assert.equal(last, html);
  assert.equal(live.firstChild, paragraph);
  globalThis.document.createElement = build;
});
