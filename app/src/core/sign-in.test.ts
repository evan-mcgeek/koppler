import { expect, test } from 'vitest';
import { isSignIn, signInOf } from './sign-in.ts';

test('the AWS shorthand and a sign-in of the stack come out in one shape', () => {
  expect(signInOf(null, { sso: 'acme-qa' })).toEqual({
    id: 'sso:acme-qa',
    what: 'AWS (acme-qa)',
    check: { argv: ['aws', 'sts', 'get-caller-identity', '--profile', 'acme-qa'] },
    login: 'aws sso login --profile acme-qa',
    env: { AWS_PROFILE: 'acme-qa' },
    tool: 'aws',
  });
  const signIns = {
    dev: { what: 'Azure', check: 'az account show', login: 'az login --tenant acme', env: { A: '1' } },
  };
  expect(signInOf({ signIns }, { signIn: 'dev' })).toEqual({
    id: 'sign-in:dev',
    what: 'Azure',
    check: { shell: 'az account show' },
    login: 'az login --tenant acme',
    env: { A: '1' },
    tool: 'az',
  });
});

test('a need that is no sign-in, or names one the stack does not have, is none', () => {
  expect(signInOf({ signIns: {} }, { signIn: 'dev' })).toBeNull();
  expect(signInOf(null, {})).toBeNull();
  expect(isSignIn({ signIn: 'dev' })).toBe(true);
  expect(isSignIn({})).toBe(false);
});
