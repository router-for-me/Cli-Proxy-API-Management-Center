import { expect, test } from 'bun:test';
import type { BlockerFunction } from 'react-router';
import { guardDocumentExit } from '../src/hooks/useUnsavedChangesGuard';

const location = { pathname: '/editor', search: '?view=graph', hash: '', state: null, key: 'a' };

function attemptExit(target: EventTarget) {
  const event = new Event('beforeunload', { cancelable: true });
  // A browser BeforeUnloadEvent has a writable string returnValue, unlike Event.
  Object.defineProperty(event, 'returnValue', { value: '', writable: true });
  target.dispatchEvent(event);
  return event;
}

test('only an enabled dirty draft requests native confirmation, until effect cleanup', () => {
  const target = new EventTarget();
  expect(guardDocumentExit(target, false, true, location)).toBeUndefined();
  expect(guardDocumentExit(target, true, false, location)).toBeUndefined();
  expect(attemptExit(target).defaultPrevented).toBe(false);

  const cleanup = guardDocumentExit(target, true, true, location);
  const exit = attemptExit(target);
  expect(exit.defaultPrevented).toBe(true);
  expect(exit.returnValue).toBeTruthy();
  cleanup?.();
  expect(attemptExit(target).defaultPrevented).toBe(false);
});

test('document exit leaves the current route for a path-sensitive draft guard', () => {
  const target = new EventTarget();
  for (const dirty of [true, false]) {
    const predicate: BlockerFunction = ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname;
    const cleanup = guardDocumentExit(target, true, predicate, location);
    expect(attemptExit(target).defaultPrevented).toBe(dirty);
    cleanup?.();
  }
});
