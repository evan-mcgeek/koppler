// A sign-in an app needs before it starts. The engine knows one shape: how to tell it holds, what the user runs when
// it does not, and the settings it gives the app. AWS is built in as the shorthand `sso`; anything else (Azure,
// Google Cloud, Firebase) is declared by the stack under `signIns`.

/** A sign-in as a stack declares it. Its `check` is a command of the stack's, so it runs only once approved. */
export interface DeclaredSignIn {
  /** What it signs in to, as the user reads it: "Azure". */
  what?: string | undefined;
  /** A command that succeeds while the sign-in holds. */
  check: string;
  /** What the user runs to sign in. */
  login: string;
  /** Settings the app is started with. */
  env?: Record<string, string> | undefined;
}
export interface SignIn {
  /** The id of its step for the user. */
  id: string;
  what: string;
  /** A program with its arguments when it is built in; a shell command when the stack wrote it. */
  check: { argv: string[] } | { shell: string };
  login: string;
  env: Record<string, string>;
  /** The program it needs installed. */
  tool: string;
}
interface Need {
  sso?: string | undefined;
  signIn?: string | undefined;
}

/** The sign-in a need of an app stands for; null when it is not one, or names one the stack does not declare. */
export function signInOf(
  stack: { signIns?: Record<string, DeclaredSignIn | undefined> | undefined } | null | undefined,
  need: Need | null | undefined,
): SignIn | null {
  if (need?.sso)
    return {
      id: `sso:${need.sso}`,
      what: `AWS (${need.sso})`,
      check: { argv: ['aws', 'sts', 'get-caller-identity', '--profile', need.sso] },
      login: `aws sso login --profile ${need.sso}`,
      env: { AWS_PROFILE: need.sso },
      tool: 'aws',
    };
  const declared = need?.signIn ? stack?.signIns?.[need.signIn] : undefined;
  if (!need?.signIn || !declared) return null;
  return {
    id: `sign-in:${need.signIn}`,
    what: declared.what ?? need.signIn,
    check: { shell: declared.check },
    login: declared.login,
    env: declared.env ?? {},
    tool: declared.login.trim().split(/\s+/)[0] ?? '',
  };
}
/** Whether a need is a sign-in of either form. */
export const isSignIn = (need: Need | null | undefined): boolean => !!(need?.sso || need?.signIn);
