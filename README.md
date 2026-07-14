# wc-speech

**v1.0 release candidate** — the markup contract is stabilizing; [open an issue](https://github.com/Hintzmann/wc-speech/issues) if you integrate before final 1.0.0.

A small web component that adds an in-page **speech tool** for sighted users without text-to-speech software installed. Built on the [Web Speech API](https://caniuse.com/speech-synthesis). Not a replacement for assistive technology.

Maintained by [Martin Hintzmann](https://github.com/Hintzmann). The component builds on ideas from [Dave Bushell's text-to-speech synthesis article](https://dbushell.com/2025/07/26/text-to-speech-synthesis/) and is developed with automated tests (Node.js + jsdom) and manual browser checks. See [Development](#development) below.

## Demo

**Live demos:** [hintzmann.github.io/wc-speech/demo/](https://hintzmann.github.io/wc-speech/demo/) — [simple](https://hintzmann.github.io/wc-speech/demo/simple/) · [advanced](https://hintzmann.github.io/wc-speech/demo/advanced/).

**Local preview** — from the repository root:

```bash
npm install
npm start
```

Open [http://localhost:3000/demo/](http://localhost:3000/demo/) and choose **simple** or **advanced**.

## Quick start

Copy these files into your project (self-host; there is no npm package or CDN build):

- `wc-speech.js` — the component (required; use for development)
- `wc-speech.min.js` — minified build (optional; use in production)
- `speech.css` — sentence and word highlights (required)
- `speech-advanced.css` — optional fixed speech bar, popover, and toolbar helpers (advanced integration only)

Minimal wiring:

```html
<link rel="stylesheet" href="speech.css">

<wc-speech id="speech" target="#article" hidden aria-hidden="true" prefer-voice="Microsoft">
  <button type="button" commandfor="speech" command="--playpause">
    <span data-speech-face="play">Listen</span>
    <span data-speech-face="pause" hidden>Pause</span>
  </button>
</wc-speech>

<article id="article" lang="en">
  <h1>Readable content</h1>
  <p>Content to speak.</p>
</article>

<script type="module" src="wc-speech.js"></script>
```

Use `wc-speech.min.js` instead of `wc-speech.js` in production if you do not need to read the source.

See `demo/simple/index.html` for this layout, or `demo/advanced/index.html` for the full speech bar and voice picker.

Point `target` at **readable content only**. Put `<wc-speech>` **outside** the target when you can. Set `lang` on `<html>` and on any section that uses another language.

## Documentation

Full API reference, decision guide, and troubleshooting live on the demo hub:

**[demo/index.html#documentation](demo/index.html#documentation)**

| Topic | Section |
| --- | --- |
| When to use (and when not to) | [#when-to-use](demo/index.html#when-to-use) |
| Attributes, commands, events | [#documentation](demo/index.html#documentation) |
| Common problems | [#troubleshooting](demo/index.html#troubleshooting) |

## When to use (summary)

Use `wc-speech` when you want an optional in-page listen button for **sighted visitors** who do not already use text-to-speech software — for example to offer a spoken version of written content alongside the text.

Do **not** use it as your primary accessibility strategy. Screen reader users and people who rely on operating-system narration already have better tools; the component sets `aria-hidden="true"` on the speech tool so it stays out of their way.

For the full comparison with assistive technology, OS read-aloud, and other TTS approaches, see [When to use](demo/index.html#when-to-use) in the demo documentation.

## Development

Regenerate the minified file after editing the source:

```bash
npm run build
```

Run the automated test suite:

```bash
npm test
```

Tests run in CI on every push and pull request to `main` ([`.github/workflows/test.yml`](.github/workflows/test.yml)). Speech behaviour is covered with jsdom mocks; browser-specific quirks (voice quality, word boundaries, pause/resume) are verified manually in Chrome, Edge, Firefox, and Safari before releases.

## Feedback

[Open an issue](https://github.com/Hintzmann/wc-speech/issues) for bugs, integration feedback, or API naming — especially around markup and browser behaviour.

## License

MIT — see [LICENSE](LICENSE).

This project is a **gift**: free to use, modify, and share. If you improve it, consider sharing back. Please do not sell this as-is as a paid product; point people to the free version instead.
