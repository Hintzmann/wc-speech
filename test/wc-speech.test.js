import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  installSpeechMocks,
  loadComponent,
  removeSpeechMocks,
  resetComponentLoader,
  resetSpeechInstance,
  setupDom,
  speechMocks,
} from './helpers/setup-dom.js';

const BASIC_MARKUP = `
  <button type="button" id="play" commandfor="speech" command="--playpause">Play</button>
  <button type="button" id="hide" commandfor="speech" command="--hide-controls">Hide</button>
  <wc-speech id="speech" target="#article">
    <p role="status"></p>
    <p data-speech-error hidden></p>
  </wc-speech>
  <article id="article"><p>Hello world.</p></article>
`;

function clickPlay() {
  document.getElementById('play').click();
}

function clickHide() {
  document.getElementById('hide').click();
}

function speechElement() {
  return document.getElementById('speech');
}

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
    document.documentElement.setAttribute('lang', 'en');
    setupDom(BASIC_MARKUP);
  });

  describe('single instance', () => {
    it('enforces a single active instance per page', () => {
      const duplicate = document.createElement('wc-speech');
      duplicate.id = 'speech-duplicate';
      duplicate.setAttribute('target', '#article');
      document.body.appendChild(duplicate);

      assert.equal(document.querySelectorAll('wc-speech').length, 2);
      assert.equal(duplicate.getAttribute('data-speech-blocked'), 'duplicate');
      assert.equal(duplicate.hasAttribute('data-speech-state'), false);
    });

    it('promotes the next instance when the active one is removed', () => {
      const duplicate = document.createElement('wc-speech');
      duplicate.id = 'speech-duplicate';
      duplicate.setAttribute('target', '#article');
      document.body.appendChild(duplicate);

      speechElement().remove();
      assert.equal(duplicate.getAttribute('data-speech-blocked'), null);
      assert.equal(duplicate.getAttribute('data-speech-state'), 'ready');
    });
  });

  describe('error reporting', () => {
    it('reports unsupported when speech synthesis is unavailable', () => {
      resetSpeechInstance();
      document.body.innerHTML = '';
      removeSpeechMocks();
      setupDom(BASIC_MARKUP);

      const speech = speechElement();
      assert.equal(speech.getAttribute('data-speech-state'), 'unsupported');
      assert.equal(speech.dataset.speechErrorCode, 'unsupported');
      assert.equal(speech.querySelector('[data-speech-error]')?.hidden, false);
    });

    it('reports missing-target when target attribute is absent', () => {
      const speech = speechElement();
      speech.removeAttribute('target');

      const errors = [];
      speech.addEventListener('speech-error', (event) => errors.push(event.detail));

      clickPlay();

      assert.equal(speech.getAttribute('data-speech-state'), 'error');
      assert.equal(speech.dataset.speechErrorCode, 'missing-target');
      assert.equal(errors.at(-1)?.code, 'missing-target');
      assert.match(errors.at(-1)?.message ?? '', /target attribute/i);
    });

    it('reports target-not-found for a missing selector match', () => {
      const speech = speechElement();
      speech.setAttribute('target', '#missing');

      clickPlay();

      assert.equal(speech.dataset.speechErrorCode, 'target-not-found');
      assert.equal(speech.querySelector('[data-speech-error]')?.hidden, false);
    });

    it('reports missing-lang when html has no lang attribute', () => {
      document.documentElement.removeAttribute('lang');

      clickPlay();

      const speech = speechElement();
      assert.equal(speech.dataset.speechErrorCode, 'missing-lang');
      assert.equal(speech.getAttribute('data-speech-state'), 'error');
    });

    it('reports empty-content when the target has no readable text', () => {
      document.getElementById('article').innerHTML = '<button type="button">Skip me</button>';

      clickPlay();

      const speech = speechElement();
      assert.equal(speech.dataset.speechErrorCode, 'empty-content');
      assert.equal(speech.getAttribute('data-speech-state'), 'error');
    });

    it('reports synthesis-failed when an utterance errors', () => {
      const speech = speechElement();
      const errors = [];
      speech.addEventListener('speech-error', (event) => errors.push(event.detail));

      clickPlay();
      const utterance = speechMocks().utterances.at(-1);
      assert.ok(utterance);

      speechMocks().fireError(utterance, 'network');

      assert.equal(speech.dataset.speechErrorCode, 'synthesis-failed');
      assert.equal(speech.getAttribute('data-speech-state'), 'error');
      assert.equal(errors.at(-1)?.code, 'synthesis-failed');
      assert.equal(errors.at(-1)?.error, 'network');
      assert.equal(speech.classList.contains('speaking'), false);
    });

    it('clears error state when speech starts successfully', () => {
      const speech = speechElement();
      speech.setAttribute('target', '#missing');
      clickPlay();
      assert.equal(speech.dataset.speechErrorCode, 'target-not-found');

      speech.setAttribute('target', '#article');
      clickPlay();

      assert.equal(speech.hasAttribute('data-speech-error-code'), false);
      assert.equal(speech.querySelector('[data-speech-error]')?.hidden, true);
      assert.equal(speech.getAttribute('data-speech-state'), 'speaking');
    });
  });

  describe('speech events', () => {
    it('dispatches speech-start and sentence-change when reading begins', () => {
      const speech = speechElement();
      const events = [];
      for (const type of ['speech-start', 'sentence-change']) {
        speech.addEventListener(type, (event) => events.push({ type, detail: event.detail }));
      }

      clickPlay();

      const start = events.find(({ type }) => type === 'speech-start');
      const sentence = events.find(({ type }) => type === 'sentence-change');

      assert.ok(start);
      assert.equal(start.detail.index, 0);
      assert.equal(start.detail.total, 1);
      assert.ok(sentence);
      assert.equal(sentence.detail.index, 0);
      assert.equal(sentence.detail.total, 1);
      assert.equal(sentence.detail.text, 'Hello world.');
      assert.equal(speech.getAttribute('data-speech-state'), 'speaking');
    });

    it('dispatches speech-finish when the last sentence completes', () => {
      const speech = speechElement();
      const finished = [];
      speech.addEventListener('speech-finish', (event) => finished.push(event.detail));

      clickPlay();
      speechMocks().fireEnd(speechMocks().utterances.at(-1));

      assert.equal(finished.length, 1);
      assert.equal(finished[0].index, 1);
      assert.equal(speech.getAttribute('data-speech-state'), 'ready');
      assert.equal(speech.classList.contains('speaking'), false);
    });

    it('dispatches speech-stop when controls are hidden during speech', () => {
      const speech = speechElement();
      const stopped = [];
      speech.addEventListener('speech-stop', (event) => stopped.push(event.detail));

      clickPlay();
      clickHide();

      assert.equal(stopped.length, 1);
      assert.equal(stopped[0].index, 0);
      assert.equal(speech.getAttribute('data-speech-state'), 'ready');
      assert.equal(speech.classList.contains('speaking'), false);
    });
  });

  describe('speech loop', () => {
    it('ignores stale utterance end callbacks after speech is cancelled', () => {
      const speech = speechElement();
      const finishedEvents = [];
      speech.addEventListener('speech-finish', () => finishedEvents.push(true));

      clickPlay();
      const utterance = speechMocks().utterances.at(-1);
      assert.ok(utterance);

      clickPlay();
      speechMocks().fireEnd(utterance);

      assert.equal(speech.getAttribute('data-speech-state'), 'paused');
      assert.equal(finishedEvents.length, 0);
    });

    it('ignores stale utterance error callbacks after speech is cancelled', () => {
      const speech = speechElement();
      const errors = [];
      speech.addEventListener('speech-error', (event) => errors.push(event.detail));

      clickPlay();
      const utterance = speechMocks().utterances.at(-1);
      assert.ok(utterance);

      clickPlay();
      speechMocks().fireError(utterance, 'interrupted');

      assert.equal(errors.length, 0);
      assert.equal(speech.getAttribute('data-speech-state'), 'paused');
    });
  });
});
