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

function pressEscape() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function mouseup() {
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

function flushDeferredSelection() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function selectTextIn(element, start, end) {
  const textNode = element.firstChild;
  assert.ok(textNode);

  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

const SELECTION_MARKUP = `
  <button type="button" id="play" commandfor="speech" command="--playpause">Play</button>
  <button type="button" id="marked" commandfor="speech" command="--speech-marked">Read selection</button>
  <wc-speech id="speech" target="#article">
    <div id="selection-toolbar" popover="auto" role="toolbar" hidden>
      <button type="button" commandfor="speech" command="--speech-marked">Read selection</button>
    </div>
    <div id="options" popover hidden></div>
  </wc-speech>
  <article id="article"><p>Hello world.</p><p>Second paragraph with more text.</p></article>
  <p id="outside">Outside content.</p>
`;

function clickMarked() {
  document.getElementById('marked').click();
}

function selectAllIn(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
}

function setupSelectionArticle(markup, lang = 'en') {
  document.documentElement.setAttribute('lang', lang);
  setupDom(`
    <button type="button" id="marked" commandfor="speech" command="--speech-marked">Read selection</button>
    <wc-speech id="speech" target="#article">
      <div id="selection-toolbar" popover="auto" role="toolbar" hidden>
        <button type="button" commandfor="speech" command="--speech-marked">Read selection</button>
      </div>
    </wc-speech>
    <article id="article">${markup}</article>
  `);
}

async function speakMarkedSelection(selectFn) {
  await selectFn(document.querySelector('#article'));
  mouseup();
  await flushDeferredSelection();
  clickMarked();

  while (speechElement().classList.contains('speaking')) {
    const utterances = speechMocks().utterances;
    speechMocks().fireEnd(utterances[utterances.length - 1]);
  }

  return speechMocks().utterances.map((utterance) => ({
    text: utterance.text,
    lang: utterance.lang,
  }));
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

  describe('escape key', () => {
    it('dispatches speech-stop when Escape is pressed during speech', () => {
      const speech = speechElement();
      const stopped = [];
      speech.addEventListener('speech-stop', (event) => stopped.push(event.detail));

      clickPlay();
      pressEscape();

      assert.equal(stopped.length, 1);
      assert.equal(stopped[0].index, 0);
      assert.equal(speech.getAttribute('data-speech-state'), 'ready');
      assert.equal(speech.classList.contains('speaking'), false);
    });

    it('does nothing when Escape is pressed while speech is idle', () => {
      const speech = speechElement();
      const stopped = [];
      speech.addEventListener('speech-stop', (event) => stopped.push(event.detail));

      pressEscape();

      assert.equal(stopped.length, 0);
      assert.equal(speech.getAttribute('data-speech-state'), 'ready');
    });

    it('closes the options popover before stopping speech', () => {
      resetSpeechInstance();
      setupDom(`
        <button type="button" id="play" commandfor="speech" command="--playpause">Play</button>
        <wc-speech id="speech" target="#article">
          <div id="options" popover hidden></div>
        </wc-speech>
        <article id="article"><p>Hello world.</p></article>
      `);

      const speech = speechElement();
      const stopped = [];
      speech.addEventListener('speech-stop', (event) => stopped.push(event.detail));

      clickPlay();
      speech.querySelector('#options').showPopover();

      pressEscape();

      assert.equal(stopped.length, 0);
      assert.equal(speech.querySelector('#options').hidden, true);
      assert.equal(speech.classList.contains('speaking'), true);

      pressEscape();

      assert.equal(stopped.length, 1);
      assert.equal(speech.classList.contains('speaking'), false);
    });
  });

  describe('inline text flow', () => {
    function collectSentences(markup, lang = 'en') {
      document.documentElement.setAttribute('lang', lang);
      setupDom(`
        <button type="button" id="play" commandfor="speech" command="--playpause">Play</button>
        <wc-speech id="speech" target="#article"></wc-speech>
        <article id="article">${markup}</article>
      `);

      const speech = speechElement();
      const sentences = [];
      speech.addEventListener('sentence-change', (event) => sentences.push(event.detail));

      clickPlay();

      while (speechElement().classList.contains('speaking')) {
        const utterances = speechMocks().utterances;
        speechMocks().fireEnd(utterances[utterances.length - 1]);
      }

      return sentences;
    }

    it('merges inline markup into full sentences', () => {
      const sentences = collectSentences(`
        <p>
          Click <strong><span aria-hidden="true">🗣️</span> Speech tool</strong> in the top-right corner to open the toolbar.
          Press <span aria-hidden="true">▶️</span> play to have this page spoken.
        </p>
      `);

      assert.equal(sentences.length, 2);
      assert.equal(
        sentences[0].text,
        'Click Speech tool in the top-right corner to open the toolbar.',
      );
      assert.equal(sentences[1].text, 'Press play to have this page spoken.');
    });

    it('keeps link text in the sentence flow', () => {
      const sentences = collectSentences(`
        <p>read the <a href="https://example.test/article">full article</a> for the complete speech.</p>
      `);

      assert.equal(sentences.length, 1);
      assert.match(sentences[0].text, /full article/);
      assert.equal(sentences[0].text, 'read the full article for the complete speech.');
    });

    it('skips aria-hidden inline content while preserving surrounding text', () => {
      const sentences = collectSentences(`
        <p>Press <strong><span aria-hidden="true">🗣️</span> Listen</strong> to hear this article.</p>
      `);

      assert.equal(sentences.length, 1);
      assert.equal(sentences[0].text, 'Press Listen to hear this article.');
      assert.doesNotMatch(sentences[0].text, /🗣️/);
    });

    it('splits mixed-language inline content into separate runs', () => {
      const sentences = collectSentences(`
        <p>Et højdepunkt er Claude Monets "<span lang="fr">Impression, soleil levant</span>" på museet.</p>
      `, 'da');

      assert.equal(sentences.length, 3);
      assert.match(sentences[0].text, /Claude Monets/);
      assert.equal(sentences[1].text, 'Impression, soleil levant');
      assert.equal(sentences[2].text, '" på museet.');
      assert.equal(speechMocks().utterances[1]?.lang, 'fr');
    });

    it('expands inline abbr title text inside a single sentence', () => {
      const sentences = collectSentences(`
        <p>På Skagens Museum kan man se en udstilling om <abbr title="Peder Severin Krøyer">P.S. Krøyer</abbr> og den franske kunstscene.</p>
      `, 'da');

      assert.equal(sentences.length, 1);
      assert.equal(
        sentences[0].text,
        'På Skagens Museum kan man se en udstilling om Peder Severin Krøyer og den franske kunstscene.',
      );
      assert.doesNotMatch(sentences[0].text, /P\.S\. Krøyer/);
    });

    it('keeps inline code in the sentence flow', () => {
      const sentences = collectSentences(`
        <p>
          An <code>abbr</code> with a <code>title</code> is spoken as the expansion:
          <abbr title="European Accessibility Act">EAA</abbr>.
        </p>
      `);

      assert.equal(sentences.length, 2);
      assert.equal(
        sentences[0].text,
        'An abbr with a title is spoken as the expansion:',
      );
      assert.equal(sentences[1].text, 'European Accessibility Act.');
      assert.equal(speechMocks().utterances[0]?.lang, 'en');
    });

    it('keeps flow-breakers as separate queue entries', () => {
      const sentences = collectSentences(`
        <p>Before image <img src="portrait.jpg" alt="Portrait alt text"> after image.</p>
      `);

      assert.equal(sentences.length, 3);
      assert.equal(sentences[0].text, 'Before image');
      assert.equal(sentences[1].text, 'Portrait alt text');
      assert.equal(sentences[2].text, 'after image.');
    });

    it('keeps pre blocks as separate queue entries', () => {
      const sentences = collectSentences(`
        <p>Inline and block code:
          <pre><code>console.log('Hello');</code></pre>
        </p>
      `);

      assert.equal(sentences.length, 2);
      assert.equal(sentences[0].text, 'Inline and block code:');
      assert.equal(sentences[1].text, "console.log('Hello');");
      assert.equal(speechMocks().utterances[1]?.lang, 'en');
    });
  });

  describe('selection read-aloud', () => {
    beforeEach(() => {
      resetSpeechInstance();
      installSpeechMocks();
      document.documentElement.setAttribute('lang', 'en');
      setupDom(SELECTION_MARKUP);
    });

    it('shows the selection toolbar when text is marked in the target', async () => {
      const paragraph = document.querySelector('#article p');
      selectTextIn(paragraph, 0, 5);
      mouseup();
      await flushDeferredSelection();

      const toolbar = speechElement().querySelector('#selection-toolbar');
      assert.equal(toolbar._popoverOpen, true);
      assert.match(toolbar.style.left, /^\d+(\.\d+)?px$/);
      assert.match(toolbar.style.top, /^\d+(\.\d+)?px$/);
    });

    it('does not show the selection toolbar for text outside the target', async () => {
      const outside = document.getElementById('outside');
      selectTextIn(outside, 0, 7);
      mouseup();
      await flushDeferredSelection();

      const toolbar = speechElement().querySelector('#selection-toolbar');
      assert.notEqual(toolbar._popoverOpen, true);
    });

    it('does not show the selection toolbar for a collapsed selection', async () => {
      const paragraph = document.querySelector('#article p');
      const textNode = paragraph.firstChild;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.collapse(true);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);

      mouseup();
      await flushDeferredSelection();

      const toolbar = speechElement().querySelector('#selection-toolbar');
      assert.notEqual(toolbar._popoverOpen, true);
    });

    it('reads only the marked text with --speech-marked', async () => {
      const paragraph = document.querySelector('#article p');
      selectTextIn(paragraph, 0, 5);
      mouseup();
      await flushDeferredSelection();

      clickMarked();

      const utterance = speechMocks().utterances.at(-1);
      assert.equal(utterance.text, 'Hello');
    });

    it('clears the native selection when marked speech starts', async () => {
      const paragraph = document.querySelector('#article p');
      const selection = selectTextIn(paragraph, 0, 5);
      mouseup();
      await flushDeferredSelection();

      assert.equal(selection.toString(), 'Hello');

      clickMarked();

      assert.equal(selection.rangeCount, 0);
    });

    it('pauses and resumes marked speech on repeated --speech-marked clicks', async () => {
      const paragraph = document.querySelector('#article p');
      selectTextIn(paragraph, 0, 5);
      mouseup();
      await flushDeferredSelection();

      const speech = speechElement();
      clickMarked();
      assert.equal(speech.getAttribute('data-speech-state'), 'speaking');
      assert.equal(speechMocks().utterances.length, 1);

      clickMarked();
      assert.equal(speech.getAttribute('data-speech-state'), 'paused');
      assert.equal(speechMocks().utterances.length, 1);

      clickMarked();
      assert.equal(speech.getAttribute('data-speech-state'), 'speaking');
      assert.equal(speechMocks().utterances.length, 2);
    });

    it('switches from full-page speech to marked speech', async () => {
      clickPlay();
      assert.equal(speechElement().getAttribute('data-speech-state'), 'speaking');

      const paragraph = document.querySelector('#article p');
      selectTextIn(paragraph, 0, 5);
      mouseup();
      await flushDeferredSelection();
      clickMarked();

      const utterance = speechMocks().utterances.at(-1);
      assert.equal(utterance.text, 'Hello');
    });

    it('syncs data-speech-face on --speech-marked buttons', async () => {
      setupSelectionArticle('<p>Hello world.</p>');
      const markedButton = document.getElementById('marked');
      markedButton.innerHTML = `
        <span data-speech-face="play">Read</span>
        <span data-speech-face="pause" hidden>Pause</span>
      `;

      const paragraph = document.querySelector('#article p');
      selectTextIn(paragraph, 0, 5);
      mouseup();
      await flushDeferredSelection();
      clickMarked();

      const playFace = markedButton.querySelector('[data-speech-face="play"]');
      const pauseFace = markedButton.querySelector('[data-speech-face="pause"]');
      assert.equal(playFace.hidden, true);
      assert.equal(pauseFace.hidden, false);
      assert.equal(markedButton.getAttribute('data-speech-action'), 'pause');

      clickMarked();

      assert.equal(playFace.hidden, false);
      assert.equal(pauseFace.hidden, true);
      assert.equal(markedButton.getAttribute('data-speech-action'), 'play');
    });

    it('expands abbr title text when the marked selection includes the abbreviation', async () => {
      setupSelectionArticle(`
        <p>På Skagens Museum kan man se en udstilling om <abbr title="Peder Severin Krøyer">P.S. Krøyer</abbr> og den franske kunstscene.</p>
      `, 'da');

      const utterances = await speakMarkedSelection(async (article) => {
        selectAllIn(article.querySelector('p'));
      });

      assert.equal(utterances.length, 1);
      assert.match(utterances[0].text, /Peder Severin Krøyer/);
      assert.doesNotMatch(utterances[0].text, /P\.S\. Krøyer/);
    });

    it('skips aria-hidden inline content inside a marked selection', async () => {
      setupSelectionArticle(`
        <p>Press <strong><span aria-hidden="true">🗣️</span> Listen</strong> to hear this article.</p>
      `);

      const utterances = await speakMarkedSelection(async (article) => {
        selectAllIn(article.querySelector('p'));
      });

      assert.equal(utterances.length, 1);
      assert.equal(utterances[0].text, 'Press Listen to hear this article.');
      assert.doesNotMatch(utterances[0].text, /🗣️/);
    });

    it('uses separate language runs for mixed-language marked selections', async () => {
      setupSelectionArticle(`
        <p>Et højdepunkt er Claude Monets "<span lang="fr">Impression, soleil levant</span>" på museet.</p>
      `, 'da');

      const utterances = await speakMarkedSelection(async (article) => {
        selectAllIn(article.querySelector('p'));
      });

      assert.equal(utterances.length, 3);
      assert.match(utterances[0].text, /Claude Monets/);
      assert.equal(utterances[1].text, 'Impression, soleil levant');
      assert.equal(utterances[1].lang, 'fr');
      assert.equal(utterances[2].text, '" på museet.');
    });

    it('clips marked speech to a partial sentence', async () => {
      setupSelectionArticle('<p>Hello world.</p>');

      const utterances = await speakMarkedSelection(async (article) => {
        selectTextIn(article.querySelector('p'), 6, 11);
      });

      assert.equal(utterances.length, 1);
      assert.equal(utterances[0].text, 'world');
    });

    it('closes the selection toolbar on Escape without stopping speech', async () => {
      const paragraph = document.querySelector('#article p');
      selectTextIn(paragraph, 0, 5);
      mouseup();
      await flushDeferredSelection();

      clickPlay();

      const speech = speechElement();
      const stopped = [];
      speech.addEventListener('speech-stop', (event) => stopped.push(event.detail));

      pressEscape();

      const toolbar = speech.querySelector('#selection-toolbar');
      assert.notEqual(toolbar._popoverOpen, true);
      assert.equal(stopped.length, 0);
      assert.equal(speech.classList.contains('speaking'), true);

      pressEscape();

      assert.equal(stopped.length, 1);
      assert.equal(speech.classList.contains('speaking'), false);
    });

    it('keeps resolving the options popover when a selection toolbar is present', () => {
      const speech = speechElement();
      const options = speech.querySelector('#options');
      assert.equal(options, speech.querySelector('[popover]:not([role="toolbar"])'));
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
