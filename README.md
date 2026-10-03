# dsh-client-ui-font-scale

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **client (browser) plugin**
that puts conversation font-size controls where you are already looking: a stepper in the composer
tool row, keyboard shortcuts, and `Ctrl`+wheel zoom.

No build step. The `lib/*.js` files are authored directly in the shipped bundle format, so cloning
the repository is enough.

## Why this exists

DSH already ships a conversation font-size setting — **Settings → General → 字号大小 / Font size**,
contributed by `@deepseek-ai/dsh-client-ui-theme`. Its copy is explicit that it *"only affects
conversation content"*, which is exactly the right scope.

This plugin does not replace or reimplement it. It adds the input surfaces that setting lacks:

- reaching it takes four clicks, so it is easy to forget it exists;
- there is no keyboard shortcut for it anywhere in the shipped shortcuts registry;
- there is no wheel gesture for it.

Every control here writes through the **same** `theme.setFontSize` entry point the shipped row uses,
so the two can never disagree.

## What it does

| Surface | Where | Behaviour |
|---|---|---|
| Stepper | composer tool row, before the submit action | `A−` / readout / `A+`, clamping at the ends |
| Reset | beside the stepper | `↺` restores the default; greys out when already there |
| Shortcuts | `Ctrl`+`=` / `Ctrl`+`-` / `Ctrl`+`0` | increase / decrease / restore default |
| Zoom | `Ctrl`+wheel over the page | wheel up enlarges, wheel down shrinks |

Both the readout and the reset button render the **live** size from the theme snapshot, so a change
made in the shipped settings row updates this control immediately, and vice versa.

## Requirements

- DeepSeek Harness with the Web client (the `desktop` profile, or any profile mounting
  `@deepseek-ai/dsh-web-app`).
- A theme service that exposes `setFontSize` — i.e. `@deepseek-ai/dsh-client-ui-theme`, which ships
  in the default composition.
- No build step and no runtime dependencies beyond the browser module table.

## Install

This package is a **dsh bundle**: `package.json` declares `dsh.bundle.patch`, so dsh treats
[`cordis.patch.yml`](cordis.patch.yml) as a composition layer and mounts it for you.

```sh
dsh plugin --profile <profile> add dsh-client-ui-font-scale
```

That installs the package into the profile and appends it to the profile's bundle list. The profile
is watched, so dsh recomposes without a restart. Remove it with
`dsh plugin --profile <profile> remove dsh-client-ui-font-scale`.

### From a local checkout

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-client-ui-font-scale
```

### Mounting by hand

Compose [`cordis.patch.yml`](cordis.patch.yml) into the profile's own patch file, and make the
package resolvable from the profile directory:

```sh
pnpm add link:/absolute/path/to/dsh-client-ui-font-scale --dir "$DSH_HOME/profiles/desktop"
```

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- insert:
    - id: font-scale
      name: dsh-client-ui-font-scale
```

A patch `insert` row may also name a path instead of a package — dsh rewrites `./`-relative and
absolute names to file URLs anchored at the patch file — which needs no install at all.

After installing, **reload the page**: a client plugin's bundle is wired into the index at render
time, so a page that was already open does not pick up a newly installed bundle.

## Persistence

This plugin stores nothing, deliberately.

`theme.setFontSize(px)` writes through the `ui-theme` settings scope on the Host
(`this.host.set('fontSize', px)`), and `@deepseek-ai/dsh-client-ui-theme`'s Host half re-embeds that
durable value into **every index render** as a boot script. The result:

- the size survives a page reload;
- the size survives an application restart;
- it is applied *before the shell mounts*, so there is no flash of the default size.

A second store here would be a second source of truth for one number. If you want to change how the
size persists, change it in `dsh-client-ui-theme`, not here.

## Range

The accepted range is **10–22 px in whole steps**, default **14**. That range belongs to the theme
service: `setFontSize` throws for a fractional or out-of-range value. Every control here clamps
rather than bypassing it, so the shipped settings row and this plugin always agree.

If you need to go beyond 22 px, note that `dsh-client-ui-layout` writes the size as an
*unimportant inline* `--dsh-content-font-size` on `<body>`, so a stylesheet rule with `!important`
can override it. Doing that from a plugin means owning the resulting split-brain with the shipped
setting, which is why this plugin does not.

## How it works

| Concern | Mechanism |
|---|---|
| Seat | `ctx.slots.register` into `conversation.input.right` (a list slot, `replaceRisk: none`, empty in the default composition) |
| Read | `theme.getTheme().fontSize`, re-rendered on the `theme/change` event |
| Write | `theme.setFontSize(px)` — the only font-size write entry |
| Keys | `ctx.shortcuts.register`, so bindings appear on the Shortcuts settings page and stay user-rebindable |
| Locale | `ctx.locale.register` + `ctx.locale.bind`; the readout and labels follow the active locale |
| Styles | one `<style>` element inserted in `ctx.effect`, removed on dispose |

Two ordering details are load-bearing:

- **Services are resolved per call** (`ctx.get('theme')`), not captured once in `apply`. A peer half
  may mount after this one, and a captured miss would silently disable a surface for the whole run.
- **Shortcuts and dictionaries register through `ctx.inject`**, which waits for the service instead
  of racing it. Registering against a not-yet-mounted service is a no-op, not an error, so the
  failure would be silent.

Shortcut bindings declare `regions: ['page', 'editable']`, so they keep working while the composer
has focus. On the desktop runtime no combination is reserved (`bindingIssue` returns early for
`desktop` on Windows and macOS), so `Ctrl`+`=` / `-` / `0` register cleanly.

## Development

```sh
node scripts/validate-plugin.mjs .
# or
npm run validate
```

The validator is read-only and asserts the contract this bundle depends on: the `dsh.client`
manifest, the `dsh.bundle.patch` layer, `apply()` on the host half, the `__ModuleLoader__.load`
wrapper with a factory id equal to the package name, `require('react')` beside `createElement`,
CSS template-literal integrity, and locale-dictionary symmetry. It reads dictionary keys out of the
object literals themselves, so labels reached through a variable still count.

Also worth running before a commit:

```sh
node --check lib/client.js && node --check lib/index.js
```

## Repository layout

```
lib/index.js                host half (empty apply: the bundle owns no host capability)
lib/client.js               browser half: slots, shortcuts, wheel, styles
cordis.patch.yml            the bundle's composition layer
scripts/validate-plugin.mjs structural validation
```

## Caveats

- The control is a decoration in the composer row, not a settings replacement. The shipped
  **Settings → General → Font size** row remains the canonical place to see and set the value.
- `Ctrl`+wheel calls `preventDefault`, which suppresses the Electron shell's own page zoom. That is
  intentional — the gesture should mean one thing — but it does mean `Ctrl`+wheel no longer zooms
  the whole page.
- The wheel handler is attached to `window`, so the gesture works anywhere over the page, not only
  over the conversation column.

## License

MIT © 2026 AprilCrystal
