import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  installSpeechMocks,
  loadComponent,
  resetComponentLoader,
  resetSpeechInstance,
  setupDom,
} from './helpers/setup-dom.js';

const BASIC_MARKUP = `
  <button type="button" id="play" commandfor="speech" command="--playpause">Play</button>
  <wc-speech id="speech" target="#article">
    <p role="status"></p>
    <p data-speech-error hidden></p>
  </wc-speech>
  <article id="article"><p>Hello world.</p></article>
`;

before(async () => {
  setupDom('<div></div>');
  installSpeechMocks();
  await loadComponent();
});

after(() => {
  resetComponentLoader();
});

describe('wc-speech integration', () => {
  beforeEach(() => {
    resetSpeechInstance();
    installSpeechMocks();
    setupDom(BASIC_MARKUP);
  });

  it('enforces a single active instance per page', () => {
    const duplicate = document.createElement('wc-speech');
    duplicate.id = 'speech-duplicate';
    duplicate.setAttribute('target', '#article');
    document.body.appendChild(duplicate);

    assert.equal(document.querySelectorAll('wc-speech').length, 2);
    assert.equal(duplicate.getAttribute('data-speech-blocked'), 'duplicate');
    assert.equal(duplicate.hasAttribute('data-speech-state'), false);
  });

  it('reports missing-target when target attribute is absent', () => {
    const speech = document.getElementById('speech');
    speech.removeAttribute('target');

    const errors = [];
    speech.addEventListener('speech-error', (event) => errors.push(event.detail));

    document.getElementById('play').click();

    assert.equal(speech.getAttribute('data-speech-state'), 'error');
    assert.equal(speech.dataset.speechErrorCode, 'missing-target');
    assert.equal(errors.at(-1)?.code, 'missing-target');
    assert.match(errors.at(-1)?.message ?? '', /target attribute/i);
  });

  it('reports target-not-found for a missing selector match', () => {
    const speech = document.getElementById('speech');
    speech.setAttribute('target', '#missing');

    document.getElementById('play').click();

    assert.equal(speech.dataset.speechErrorCode, 'target-not-found');
    assert.equal(speech.querySelector('[data-speech-error]')?.hidden, false);
  });

  it('dispatches speech-start and sentence-change when reading begins', () => {
    const speech = document.getElementById('speech');
    const events = [];
    for (const type of ['speech-start', 'sentence-change']) {
      speech.addEventListener(type, (event) => events.push({ type, detail: event.detail }));
    }

    document.getElementById('play').click();

    assert.ok(events.some(({ type }) => type === 'speech-start'));
    assert.ok(events.some(({ type, detail }) => type === 'sentence-change' && detail.text === 'Hello world.'));
    assert.equal(speech.getAttribute('data-speech-state'), 'speaking');
  });

  it('ignores stale utterance end callbacks after speech is cancelled', () => {
    const mocks = installSpeechMocks();
    const speech = document.getElementById('speech');
    const finishedEvents = [];
    speech.addEventListener('speech-finish', () => finishedEvents.push(true));

    document.getElementById('play').click();
    const utterance = mocks.utterances.at(-1);
    assert.ok(utterance);

    document.getElementById('play').click();
    mocks.fireEnd(utterance);

    assert.equal(speech.getAttribute('data-speech-state'), 'paused');
    assert.equal(finishedEvents.length, 0);
  });
});
