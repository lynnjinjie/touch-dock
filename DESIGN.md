---
name: TouchDock
description: A quiet, precise local remote that turns a phone into a natural extension of the Mac.
colors:
  signal-teal: "oklch(0.54 0.11 196)"
  signal-teal-strong: "oklch(0.49 0.11 196)"
  signal-teal-soft: "oklch(0.94 0.035 196)"
  network-ink: "oklch(0.18 0.018 220)"
  mist-page: "oklch(0.965 0.006 200)"
  mist-surface: "oklch(1 0 0)"
  mist-surface-raised: "oklch(0.975 0.006 200)"
  quiet-text: "oklch(0.47 0.018 220)"
  quiet-line: "oklch(0.88 0.012 210)"
  connected-green: "oklch(0.62 0.15 145)"
  attention-amber: "oklch(0.75 0.15 75)"
  action-coral: "oklch(0.58 0.19 28)"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.signal-teal}"
    textColor: "{colors.mist-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 24px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.mist-surface}"
    textColor: "{colors.network-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  input-default:
    backgroundColor: "{colors.mist-surface-raised}"
    textColor: "{colors.network-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "48px"
  status-connected:
    backgroundColor: "{colors.signal-teal-soft}"
    textColor: "{colors.signal-teal-strong}"
    typography: "{typography.label}"
    rounded: "999px"
    padding: "0 12px"
    height: "32px"
---

# Design System: TouchDock

## 1. Overview

**Creative North Star: "The Local Signal"**

TouchDock should feel like a reliable signal passing directly between two personal devices: immediate, private, and calm. The interface uses familiar Mac and mobile control conventions, quiet neutral surfaces, and one precise teal accent so the product disappears behind the task.

Density follows context. The Mac companion presents pairing confidence, permissions, and device state with measured spacing; the phone gives most of its area to direct manipulation. The system explicitly rejects generic admin dashboards, gaming-control aesthetics, excessive black-and-neon styling, decorative glass panels, and cartoonish controls.

**Key Characteristics:**

- Connection state is always visible and stated in words, never color alone.
- A 4px spacing foundation creates compact controls and generous separation between workflows.
- Corners stay gently curved at 6px, 10px, or 14px; pills are reserved for status.
- Motion acknowledges state within 120–180ms and never delays control.
- The mobile trackpad remains the dominant surface; shortcuts stay secondary.

## 2. Colors

The palette reads like a clean local network indicator: cool mist surfaces, deep legible ink, and a restrained teal signal.

### Primary

- **Signal Teal** (`oklch(0.54 0.11 196)`): Primary actions, active tabs, selected navigation, and direct-manipulation feedback. White text reaches 4.67:1 contrast.
- **Deep Signal Teal** (`oklch(0.49 0.11 196)`): Text and icons placed on pale teal surfaces.
- **Signal Wash** (`oklch(0.94 0.035 196)`): Selected rows, status backgrounds, and low-emphasis active states.

### Secondary

- **Action Coral** (`oklch(0.58 0.19 28)`): Reserved for interrupted, failed, disconnect, and confirmed security-sensitive actions. White text reaches 4.70:1 contrast.
- **Attention Amber** (`oklch(0.75 0.15 75)`): Pairing, waiting, and caution states; never used as the sole status signal.

### Neutral

- **Network Ink** (`oklch(0.18 0.018 220)`): Primary text and high-contrast controls.
- **Mist Page** (`oklch(0.965 0.006 200)`): The outer application canvas.
- **Mist Surface** (`oklch(1 0 0)`): Windows, phone surfaces, and primary control backgrounds.
- **Raised Mist** (`oklch(0.975 0.006 200)`): Sidebars, input fields, and secondary control regions.
- **Quiet Text** (`oklch(0.47 0.018 220)`): Supporting copy and metadata.
- **Quiet Line** (`oklch(0.88 0.012 210)`): Hairline dividers and control outlines.

### Named Rules

**The Signal Rarity Rule.** Signal Teal marks primary action, selection, or live feedback and occupies no more than 10% of a TouchDock screen.

**The Status Has Words Rule.** Green, amber, and coral always appear with a label, icon, or action name.

## 3. Typography

**Display Font:** SF Pro / system UI (with Segoe UI and sans-serif fallbacks)  
**Body Font:** SF Pro / system UI (with Segoe UI and sans-serif fallbacks)  
**Label Font:** SF Pro / system UI (with Segoe UI and sans-serif fallbacks)

**Character:** One native-feeling sans family keeps the tool familiar and fast. Hierarchy comes from weight, spacing, and clear size steps rather than decorative font pairing.

### Hierarchy

- **Headline** (700, 1.75rem, 1.15): Concept and primary screen titles; letter spacing is limited to -0.025em.
- **Title** (700, 1.25rem, 1.2): Mac content headings and major panel titles.
- **Body** (400, 1rem, 1.45): Explanatory text; prose is capped at 60–70 characters per line.
- **Label** (700, 0.75rem, 1.2): Buttons, tabs, status, and compact device metadata.

### Named Rules

**The Native Voice Rule.** Use one system sans family throughout product UI; display fonts and decorative mono labels are forbidden.

## 4. Elevation

TouchDock is flat by default and uses tonal separation for internal hierarchy. Soft ambient lift is reserved for complete device silhouettes and top-level windows.

### Shadow Vocabulary

- **Window Ambient** (`0 8px 24px oklch(0.2 0.02 220 / 0.12)`): The Mac window against the prototype canvas only.
- **Device Ambient** (`0 12px 32px oklch(0.2 0.02 220 / 0.18)`): The phone silhouette against the prototype canvas only.
- **Control Lift** (`0 2px 7px oklch(0.2 0 0 / 0.1)`): Selected concept controls in the prototype toolbar.

### Named Rules

**The Ambient-Only Rule.** Shadows identify physical device layers, never ordinary cards, list rows, or nested content.

## 5. Components

Components are restrained and precise: familiar silhouettes, clear state changes, and no decorative chrome.

### Buttons

- **Shape:** Gently curved rectangle (6px radius); status badges alone may use a full pill.
- **Primary:** Signal Teal with white text, 44px minimum height, and 16–24px horizontal padding.
- **Hover / Focus:** Color deepens subtly; keyboard focus uses a 3px Signal Teal ring with a 2px offset.
- **Secondary:** Mist Surface with a Quiet Line border; active state uses Signal Wash and a 1px downward translation.

### Chips

- **Style:** Pale Signal Wash with Deep Signal Teal text and a compact 32px height.
- **State:** Always includes a text label; connection chips pair a dot with Connected, Ready, or Waiting.

### Cards / Containers

- **Corner Style:** 10px for contained tools and 14px for top-level window shells.
- **Background:** Mist Surface or Raised Mist.
- **Shadow Strategy:** Flat internally; use Quiet Line borders or tonal contrast, never both a broad shadow and a decorative border.
- **Border:** One-pixel Quiet Line on tool boundaries.
- **Internal Padding:** 12px for compact controls, 24px for workflow regions.

### Inputs / Fields

- **Style:** Raised Mist fill, Quiet Line border, 6px radius, and 48px minimum height.
- **Focus:** A visible Signal Teal focus ring; placeholders must retain body-text contrast.
- **Error / Disabled:** Error combines Action Coral with explanatory copy; disabled controls reduce emphasis but remain legible.

### Navigation

Desktop navigation uses a persistent quiet sidebar with 44px rows and a Signal Wash selected state. Mobile navigation uses three stable 44px tabs above the active control surface; core functionality never hides behind hover.

### Trackpad

The trackpad is the largest mobile region. It uses a low-contrast measurement dot field because it is an actual input canvas, a visible pointer-feedback ring, and a separate scroll rail. Pointer, touch, keyboard activation, and reduced-motion preferences are all supported.

## 6. Do's and Don'ts

### Do:

- **Do** use WCAG AA contrast, visible focus rings, 44px minimum touch targets, and text labels beside status color.
- **Do** use the 4/8/12/16/24/32/48px spacing scale and group related controls tightly.
- **Do** reserve Signal Teal for primary action, current selection, connection state, and live input feedback.
- **Do** use immediate 120–180ms state transitions and provide a reduced-motion alternative.
- **Do** preserve familiar Mac trackpad, keyboard, arrow-key, and shortcut conventions.

### Don't:

- **Don't** create generic admin dashboards or fill the interface with interchangeable statistic cards.
- **Don't** use gaming-control aesthetics, excessive black-and-neon styling, or fluorescent inactive controls.
- **Don't** use decorative glass panels, glassmorphism, gradient text, decorative blobs, or nested cards.
- **Don't** make controls cartoonish or let visual effects compete with the primary input surface.
- **Don't** use a colored side stripe greater than 1px, broad decorative shadows on bordered cards, or card radii above 16px.
- **Don't** rely on color alone for connection, permission, warning, or error states.
