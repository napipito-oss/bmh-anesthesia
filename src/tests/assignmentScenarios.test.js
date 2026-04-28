import { describe, test } from 'node:test';

describe('assignment scenarios', () => {
  test('Brand available + Endo committed > 0 -> Brand assigned to Endo care team', { todo: true }, () => {});

  test('Brand unavailable + Endo committed > 0 -> fallback MD assigned to Endo', { todo: true }, () => {});

  test('Triplet shoulder room + Nielson available -> Nielson/Lambert/Pipito priority respected', { todo: true }, () => {});

  test('OR Call available choice rejected if rooms uncovered', { todo: true }, () => {});

  test('Main OR committed count caps extra Cube rooms', { todo: true }, () => {});

  test('Cath committed count creates Cath Add-On phantom if needed', { todo: true }, () => {});

  test('No MD assigned twice', { todo: true }, () => {});

  test('Block room not stolen by non-block MD if block-capable MD remains', { todo: true }, () => {});
});
