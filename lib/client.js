/**
 * Client half of the font-scale bundle.
 *
 * The conversation font size is owned by the Client theme service; `setFontSize`
 * is its only write entry and only accepts integers inside its configured range,
 * so every path here clamps before writing. Four input surfaces drive one shared
 * step function, so they can never disagree about the current value:
 *
 *   - a stepper in the composer tool row (`conversation.input.right`)
 *   - a dedicated reset button, disabled while the size is already the default
 *   - keyboard shortcuts registered through the shortcuts service
 *   - Ctrl+wheel over the page
 *
 * Persistence is deliberately absent. `setFontSize` already writes through the
 * `ui-theme` settings scope, and the Host half re-embeds that durable value in
 * every index render, so the size survives a reload and an app restart. Storing
 * a second copy here would create two sources of truth for one number.
 *
 * Services are resolved lazily per use rather than captured once in `apply`:
 * a peer half may mount after this one, and a captured miss would silently
 * disable a surface for the rest of the run. Registration is the one case that
 * must wait, so shortcuts and dictionaries go through `ctx.inject`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-client-ui-font-scale',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /**
     * Range and step mirrored from ui-theme's exported constants
     * (FONT_SIZE_MIN / DEFAULT_FONT_SIZE / FONT_SIZE_MAX). The service throws
     * outside this range, so these are hard bounds, not preferences.
     */
    const MIN = 10
    const MAX = 22
    const DEFAULT = 14

    /** Trackpads emit dense wheel deltas; one step per cooldown keeps them sane. */
    const WHEEL_COOLDOWN_MS = 60

    const NS = 'font-scale'

    const ZH = {
      increase: '增大字号',
      decrease: '减小字号',
      reset: '恢复默认字号',
      value: '当前字号',
    }
    const EN = {
      increase: 'Increase font size',
      decrease: 'Decrease font size',
      reset: 'Restore default font size',
      value: 'Current font size',
    }

    /**
     * Host tokens only, so the control belongs to the active theme in both
     * schemes. Fallbacks cover tokens a future theme may not define.
     */
    const CSS = `
.dshfs-root { display: inline-flex; align-items: center; gap: 1px; }
.dshfs-btn {
  display: inline-flex; align-items: center; justify-content: center;
  height: 26px; min-width: 26px; padding: 0 5px;
  border: 0; border-radius: 8px; background: transparent;
  font: inherit; font-size: 12px; font-weight: 500; line-height: 1;
  color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary));
  cursor: pointer;
}
.dshfs-btn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshfs-btn:disabled { opacity: .45; cursor: default; }
/* The size readout is a passive indicator; the reset action has its own button. */
.dshfs-value {
  display: inline-flex; align-items: center; justify-content: center;
  height: 26px; min-width: 34px; padding: 0 4px;
  font-size: 11px; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary));
}
.dshfs-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
`

    /**
     * Clamp one requested size into the range the theme service accepts.
     * @param px - desired size, already integer or not.
     * @returns an integer inside MIN..MAX, or DEFAULT for unusable input.
     */
    function clamp(px) {
      const n = Math.round(Number(px))
      return Number.isFinite(n) ? Math.min(MAX, Math.max(MIN, n)) : DEFAULT
    }

    /**
     * Client plugin body: provide the four input surfaces over one write path.
     * @param ctx - client cordis context.
     */
    function apply(ctx) {
      // Resolved per call: this package may load before ui-theme provides it.
      const themeOf = () => ctx.get('theme')
      const current = () => themeOf()?.getTheme().fontSize ?? DEFAULT
      const write = (px) => {
        const theme = themeOf()
        if (theme === undefined) return
        const next = clamp(px)
        if (next === current()) return
        theme.setFontSize(next)
      }
      const step = (delta) => write(current() + delta)

      // Visible copy goes through the locale service. Registered before the
      // first bind so the keys always resolve.
      let t = (key) => ZH[key] ?? key
      const localeOf = () => ctx.get('locale')
      const bindCopy = (scope) => {
        const locale = scope.locale ?? ctx.get('locale')
        if (locale === undefined) return
        scope.effect(() => locale.register(NS, { zh: ZH, en: EN }), `${NS}: dictionaries`)
        const bound = locale.bind(NS)
        t = (key) => bound(key)
      }
      if (typeof ctx.inject === 'function') ctx.inject(['locale'], bindCopy)
      else bindCopy(ctx)

      ctx.effect(() => {
        const el = document.createElement('style')
        el.textContent = CSS
        document.head.appendChild(el)
        return () => el.remove()
      }, `${NS}: styles`)

      // Ctrl+wheel. preventDefault suppresses the shell's own page zoom so the
      // gesture means one thing only.
      let lastWheel = 0
      ctx.effect(() => {
        const onWheel = (event) => {
          if (!event.ctrlKey || event.deltaY === 0) return
          event.preventDefault()
          const now = Date.now()
          if (now - lastWheel < WHEEL_COOLDOWN_MS) return
          lastWheel = now
          step(event.deltaY < 0 ? 1 : -1)
        }
        window.addEventListener('wheel', onWheel, { passive: false })
        return () => window.removeEventListener('wheel', onWheel)
      }, `${NS}: ctrl+wheel`)

      // Registered through the shortcuts service rather than a hand-rolled key
      // listener, so the bindings appear on the Shortcuts settings page and stay
      // user-rebindable. `inject` waits for the service instead of racing it.
      const commands = [
        { id: `${NS}.increase`, code: 'Equal', alias: 'increase conversation font size', label: () => t('increase'), run: () => step(1) },
        { id: `${NS}.decrease`, code: 'Minus', alias: 'decrease conversation font size', label: () => t('decrease'), run: () => step(-1) },
        { id: `${NS}.reset`, code: 'Digit0', alias: 'restore default conversation font size', label: () => t('reset'), run: () => write(DEFAULT) },
      ]
      const registerShortcuts = (scope) => {
        const shortcuts = scope.shortcuts ?? ctx.get('shortcuts')
        if (shortcuts === undefined) return
        for (const command of commands) {
          scope.effect(() => shortcuts.register({
            id: command.id,
            label: command.label,
            aliases: ['font size', command.alias],
            defaults: {
              'desktop:macos': { code: command.code, modifiers: ['primary'] },
              'desktop:windows': { code: command.code, modifiers: ['primary'] },
              'desktop:linux': { code: command.code, modifiers: ['primary'] },
              'web:macos': { code: command.code, modifiers: ['primary'] },
              'web:windows': { code: command.code, modifiers: ['primary'] },
            },
            // "editable" keeps the bindings alive while the composer has focus.
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({ status: 'handled', run: command.run }),
          }), `${NS}: ${command.id}`)
        }
      }
      if (typeof ctx.inject === 'function') ctx.inject(['shortcuts'], registerShortcuts)
      else registerShortcuts(ctx)

      /** Composer-row stepper: read the snapshot, write through the service. */
      function Control() {
        const [, setTick] = React.useState(0)
        React.useEffect(() => {
          const bump = () => setTick((n) => n + 1)
          const offTheme = ctx.on('theme/change', bump)
          const locale = localeOf()
          const offLocale = locale !== undefined && typeof locale.subscribe === 'function'
            ? locale.subscribe(bump)
            : undefined
          return () => {
            offTheme()
            if (typeof offLocale === 'function') offLocale()
          }
        }, [])
        const size = current()
        const button = (label, glyph, delta, disabled) => h('button', {
          type: 'button',
          className: 'dshfs-btn',
          'aria-label': label,
          title: label,
          disabled,
          onClick: () => step(delta),
        }, glyph)
        return h('div', { className: 'dshfs-root' },
          button(t('decrease'), 'A\u2212', -1, size <= MIN),
          h('span', {
            className: 'dshfs-value',
            'aria-label': t('value'),
          }, `${size}px`),
          button(t('increase'), 'A+', 1, size >= MAX),
          // Disabled at the default so the affordance itself shows the state.
          h('button', {
            type: 'button',
            className: 'dshfs-btn',
            'aria-label': t('reset'),
            title: t('reset'),
            disabled: size === DEFAULT,
            onClick: () => write(DEFAULT),
          }, '\u21BA'),
        )
      }

      ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: NS,
        order: 20,
      }, Control))
    }

    return {
      inject: ['slots'],
      apply,
    }
  },
})
