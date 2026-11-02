<p align="center"><img src="src/client/owl.svg" width="96" alt="owl"></p>

# owl

A small, read-only diff viewer for git. It shows your uncommitted changes, your branch, or an open pull request side by side, in the style of WebStorm's diff view: no blank filler rows, bands that connect each change across the two sides, one file at a time, and keyboard navigation.

owl never changes your repo. It has no buttons for commit, stage or review. You read the code in owl and do the rest in your terminal or with your coding agent. An agent can also leave notes on the code that owl shows as cards (see [Agent comments](#agent-comments)).

## Requirements

- Node.js 24 or newer
- git
- [GitHub CLI](https://cli.github.com/) `gh`, logged in, for pull requests
- Google Chrome; without it owl opens your default browser

Tested on Linux.

## Install

```bash
npm install -g github:xordie/owl
```

Run the same command again to update. No clone and no build needed.

## Use

Run it from inside a git repo:

```bash
owl              # uncommitted changes, compared to the last commit
owl --branch     # everything on this branch since it split from main
owl 627          # pull request #627
```

owl opens in its own Chrome window. Outside a git repo it exits with an error.

- **Working changes:** staged, unstaged and new untracked files, compared to `HEAD`.
- **Branch vs main:** compares `HEAD` with the point where the branch left `origin/HEAD` (or `origin/main` / `origin/master`), like a pull request that isn't created yet.
- **Open PRs:** lists the open pull requests of this repo's GitHub remote. Opening one fetches its head from `origin`. A PR is loaded once and cached; press `r` to load it again.

You can switch between these in the top left of the window. Working changes and the branch view reload when the window gets focus.

Use `--no-open` to only print the URL without opening a window. The local server listens on `127.0.0.1` only and stops a few seconds after you close the window.

## Keys

| Key              | Action                                    |
| ---------------- | ----------------------------------------- |
| `n` / `F7`       | next change                               |
| `p` / `Shift+F7` | previous change                           |
| `j` / `k`        | next / previous file                      |
| `J` / `K`        | next / previous view in the source list   |
| `/`              | filter files; `Enter` opens, `Esc` closes |
| `]` / `[`        | next / previous comment                   |
| `o`              | switch between the overview and a file    |
| `c`              | show or hide comment cards                |
| `v`              | switch comment style (side / inline)      |
| `r`              | reload                                    |
| `?`              | show all keys                             |

Drag the edges to resize the sidebar, the split between the source list and the file tree, and the old/new split (the band strip in the middle). Double-click a handle to reset it.

## Agent comments

`owl comment` adds a note to a range of lines. owl shows it as a card on that code, so an agent can explain a change or walk you through a whole pull request. Notes go one way only: the agent writes them, you read them.

```bash
owl comment 627 src/rates/mapper.ts:52-58 "Why this changed, in two sentences."
owl comment 627 src/rates/mapper.ts:52-58 - < note.md       # longer text from stdin
owl comment 627 --kind fix src/rates/mapper.ts:52-58 - < note.md   # a review note
owl comment 627 --batch < walkthrough.json                 # many at once
owl comment 627 --list                                      # what is there
owl comment 627 --remove src/rates/mapper.ts:52-58          # remove one
owl comment 627 --clear                                     # remove all for this view
```

Use `--branch` instead of a PR number for the branch view, or neither for working changes. Each comment shows only in the view it was written for.

- Line numbers are 1-based, on the new (right) side. Add `--old` to comment on the old (left) side, for removed code.
- Commenting the exact same lines again replaces the text and keeps its place.
- `--batch` reads a JSON array of `{"path", "lines", "old"?, "text"}` items; if one item is bad, nothing is added. The array order is the reading order for `]` and `[`.
- Text can use a little Markdown: `code`, **bold**, lists and fenced code blocks.
- `--kind fix`, `--kind question` or `--kind nit` makes a comment a review note (`"kind"` in a batch item). It gets a colored tag, its first line shows as a title, and it also shows inline in the [overview page](#overview-page). Comments without a kind are plain explanations.

Comments are stored in `.git/owl/comments.json` (one file per worktree). They are never committed or sent anywhere. An open window shows new comments within a second.

## Overview page

An agent can also explain a whole change as one page with pictures: why it exists, the flow before and after, the key idea, where it sits in a stack. owl shows it as the first row of the file tree and opens it first. `o` switches between the page and the last file.

```bash
owl overview 627 < page.html    # write or replace (also --branch, or nothing for working changes)
owl overview 627 --clear        # remove
```

- The page is an HTML fragment, at most 300 KB. owl wraps it in its own stylesheet, which gives boxes, arrows, before/after lanes, cards and figure classes. Agents draw anything else as inline SVG.
- Any element with `data-at="path:12-20"` (add `data-old` for the old side) links to those lines in the diff. A link to a file outside the view is dimmed.
- Review notes appear inside the page, under the part they are about: under the link whose lines they overlap, else near a link to the same file, else in "Other review notes" at the end. A line under the intro counts them, and `]` / `[` step through them.
- The page runs in a sandboxed frame with scripts, forms and popups off, so agent HTML can't run code. Links to `http` pages open in your browser.

Pages are stored next to the comments, as `.git/owl/overview-<view>.html`. The classes a page can use are in `src/client/overview.css`.

`owl --help` prints all the forms.

## Development

```bash
git clone https://github.com/xordie/owl.git
cd owl
npm install      # dev tools only: TypeScript and Prettier
node src/cli.ts  # run from source (or `npm link` for an `owl` command)
npm test         # node:test
npm run check    # type check and formatting
npm run format
```

owl ships its TypeScript source. Node won't run TypeScript from inside `node_modules`, so `bin/owl.js` strips the types as Node loads owl's own files. The browser loads `src/client/*.ts` directly; the server strips the types on the fly. Syntax highlighting is a vendored copy of [highlight.js](https://highlightjs.org/).
