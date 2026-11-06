# Social Converter

Social Converter turns the active Obsidian note into Bluesky posts and themed Instagram images without modifying the note. The converter follows the active Markdown note and refreshes when its content changes. Per-slide font sizes are stored separately for each note.

> [!NOTE]
> This is a private plugin for personal use. It is not intended for submission to the official Obsidian Community Plugins catalog. It can still be installed and updated through [BRAT](https://github.com/TfTHacker/obsidian42-brat) using the repository `kpaede/Social-Converter`.

## Bluesky

The note body is split at word boundaries into posts of at most 300 characters. The limit includes the numbering suffix (`/1`, `/2`, and so on). YAML properties are not included. The character limit and separator can be changed in the plugin settings.

## Instagram

Social Converter follows the convention used by Obsidian Slides, Marp, and reveal.js: put `---` on its own line, with an empty line before and after, to start the next card.

```markdown
# A title

The text for the first card.

---

## Another card

The text for the second card.
```

Each slide can be copied as an image, saved as a PNG, or exported together with all other slides as a ZIP:

- Post: 1080 × 1350 px (4:5)
- Story: 1080 × 1920 px (9:16)

The converter can render cards with the current theme or another installed community theme in light or dark mode. Image dimensions and Bluesky numbering can be changed under **Settings → Social Converter**. Images, embedded notes, videos, and PDFs are fitted to the card; PDF embeds are rendered locally as static page previews.

Do not put an opening or closing separator around the whole note. The separator only sits *between* two cards. Keeping the blank lines is important: without the blank line before `---`, CommonMark can interpret it as an underlined heading. YAML properties at the beginning of the note are ignored. Choose **Current theme** or an installed theme, then **Light** or **Dark** before exporting. The selected color mode applies to previews and exports independently of Obsidian’s appearance.

**Global font size** sets a fixed percentage of the selected theme’s typography for all slides (100% uses the theme’s original sizes). It is also available under **Settings → Social Converter** and is saved between sessions. Each slide has its own font size override above its preview; select **Use global size** to restore inheritance. Slide overrides and appearance selections are saved with the converter workspace view. Text size never changes according to text length or available space. The preview uses a fixed layout and scales as a whole to fit the sidebar, so resizing the sidebar does not change the exported composition. Embedded images and PDF pages keep their proportions and fit the space around the text. PDF pages retain their original white margins. If text exceeds a slide, a warning asks you to reduce its font size or split the content; the plugin does not shrink the text automatically. Font size changes update the existing previews and preserve scroll position and input focus. The mouse wheel scrolls the slide list even over a preview.

## Use

Open a Markdown note, then select the ribbon icon or run **Social Converter: Open converter** from the command palette.

## Install with BRAT

1. Install and enable BRAT in Obsidian.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Enter `https://github.com/kpaede/Social-Converter`.
4. Enable **Social Converter** under **Settings → Community plugins**.

## Development checks

Run `npm run build`, `npm run lint`, and `npm run test:browser`. Browser regression tests require Node.js 22+ and Chrome or Chromium. Set `SOCIAL_CONVERTER_CHROME` if the browser is installed elsewhere. Tests use an isolated temporary profile and cover PNG output, media fitting, and native mouse-wheel and Enter-key interactions on slide 5. To also test with an installed Obsidian app stylesheet, set `SOCIAL_CONVERTER_OBSIDIAN_CSS` to its local `app.css` path.
