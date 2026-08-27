# Accessibility and Computer Use
## The golden rule

If a person cannot understand or reach a control, an agent should not be expected to depend on it either.

## Conventions

- Every icon-only button has aria-label and title.
- Tabs use role=tab, aria-selected, and aria-controls.
- Menus use role=menu and role=menuitem where appropriate.
- Decorative icons use aria-hidden=true.
- Inputs have a visible label or aria-label.
- Resize handles expose orientation and ARIA values.
- Empty states explain what to do next.
- Visible focus uses the electric accent.

## Stable IDs

Do not change these without updating tools that inspect the DOM:

| ID | Region |
| --- | --- |
| codeclub-left-sidebar | left sidebar |
| codeclub-right-sidebar | right sidebar |
| codeclub-terminal-panel | terminal |
| codeclub-browser-address | browser address bar |

## Checklist

- [ ] Can it be reached with Tab?
- [ ] Is focus visible?
- [ ] Does the screen reader know its name, role, and state?
- [ ] Can Computer Use find it by label, role, or ID?
- [ ] Does the UI explain errors and empty states?
- [ ] Does language switching translate accessible labels too?
- [ ] Does the overlay avoid blocking scrolling or selection?

Avoid clickable divs without keyboard support, unnamed inputs, selectors based only on classes or position, changing text or IDs without reviewing tools, aria-hidden on interactive elements, and animations that make the interface hard to use.
