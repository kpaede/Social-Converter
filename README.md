# Social Converter

Social Converter turns the active Obsidian note into Bluesky posts and themed Instagram images without modifying the note.

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

Do not put an opening or closing separator around the whole note. The separator only sits *between* two cards. Keeping the blank lines is important: without the blank line before `---`, CommonMark can interpret it as an underlined heading. YAML properties at the beginning of the note are ignored. Image text scales automatically according to its length. Choose **Current theme**, **Light**, or **Dark** before exporting.

## Use

Open a Markdown note, then select the ribbon icon or run **Social Converter: Open converter** from the command palette.

## Install with BRAT

1. Install and enable BRAT in Obsidian.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Enter `https://github.com/kpaede/Social-Converter`.
4. Enable **Social Converter** under **Settings → Community plugins**.
