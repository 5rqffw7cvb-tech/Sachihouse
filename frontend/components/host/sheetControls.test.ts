import { describe, expect, it } from 'vitest';
import * as controls from './sheetControls';

/**
 * The invariant these constants exist for.
 *
 * Tailwind decides between two utilities of the same category by their order in
 * its generated stylesheet, not by the order they appear in a class attribute.
 * So a control that names one category twice has a style that depends on the
 * build, which is how the invoice sheet shipped with a full-width tax dropdown
 * and a delete button off the edge of the screen.
 */

/**
 * The CSS properties a utility sets, for the categories that actually collide.
 *
 * Variant-prefixed tokens (`focus:border-brand`) are skipped: they are a
 * separate conditional rule and never fight with the base one. `px-` is
 * reported as both sides so `px-3.5 pr-8` is caught, while `pl-3 pr-7` — two
 * different properties — is not.
 */
function properties(token: string): string[] {
  if (token.includes(':')) return [];
  if (/^-?w-/.test(token)) return ['width'];
  if (/^-?h-/.test(token)) return ['height'];
  if (/^-?px-/.test(token)) return ['padding-left', 'padding-right'];
  if (/^-?pl-/.test(token)) return ['padding-left'];
  if (/^-?pr-/.test(token)) return ['padding-right'];
  if (/^-?py-/.test(token)) return ['padding-top', 'padding-bottom'];
  if (/^-?pt-/.test(token)) return ['padding-top'];
  if (/^-?pb-/.test(token)) return ['padding-bottom'];
  if (/^bg-/.test(token)) return ['background'];
  if (/^text-\[/.test(token)) return ['font-size'];
  if (/^border-(?!\d)/.test(token)) return ['border-color'];
  return [];
}

// Named rather than derived from the exports: labelClass and the panel are not
// form controls, and a heuristic that swept them in would report noise.
const CONTROL_NAMES = [
  'fieldClass',
  'textareaClass',
  'selectClass',
  'invalidFieldClass',
  'lineTextClass',
  'lineAmountClass',
  'lineTaxClass',
] as const;

const CONTROL_CLASSES = CONTROL_NAMES.map((name) => [name, controls[name]] as const);

describe('sheet control classes', () => {
  it('covers every control the module exports', () => {
    const exported = Object.keys(controls).filter((name) => (
      name.endsWith('Class') && name !== 'labelClass' && !name.startsWith('sheet')
    ));
    expect(exported.sort()).toEqual([...CONTROL_NAMES].sort());
  });

  it.each(CONTROL_CLASSES)('%s sets each property exactly once', (_name, value) => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];

    for (const token of value.split(/\s+/).filter(Boolean)) {
      for (const key of properties(token)) {
        const previous = seen.get(key);
        if (previous) {
          clashes.push(`${key}: "${previous}" and "${token}"`);
        } else {
          seen.set(key, token);
        }
      }
    }

    expect(clashes).toEqual([]);
  });

  it('keeps every focusable control at 16px so iOS does not zoom on focus', () => {
    const focusable = ['fieldClass', 'textareaClass', 'selectClass', 'invalidFieldClass',
      'lineTextClass', 'lineAmountClass', 'lineTaxClass'];
    for (const name of focusable) {
      expect(controls[name as keyof typeof controls]).toContain('text-[16px]');
    }
  });

  it('lets an input shrink below its intrinsic width', () => {
    for (const [, value] of CONTROL_CLASSES) {
      expect(value).toContain('min-w-0');
    }
  });

  it('stops the panel scrolling sideways', () => {
    expect(controls.sheetPanelClass).toContain('overflow-x-hidden');
  });
});
