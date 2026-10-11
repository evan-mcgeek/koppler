// The shape of a stack as its file states it: the apps, how each is started, what each needs and calls.
// Only what the typed modules read so far; the schema that checks a whole stack file will take this over.

export interface Secret {
  /** The setting the stored value is given to the app as. */
  env?: string;
  type?: string;
}
/** Something an app needs before it can run: a sign-in, a tunnel, a hosts entry. */
export interface Prereq {
  sso?: string;
  tunnel?: string;
  port?: number;
  env?: string;
  what?: string;
  connectsAs?: string;
  hosts?: string;
}
export interface App {
  name?: string;
  kind?: string;
  /** Where it answers when it runs on this machine. */
  url?: string;
  /** The shell command that starts it, run in its clone. */
  start?: string;
  secrets?: Secret[];
  prereqs?: Prereq[];
  /** .NET: the project to run, its launch settings file, and the profile to start from. */
  project?: string;
  launchSettings?: string;
  baseProfile?: string;
  /** Node and web: the package.json script, when it is not `dev` or `start`. */
  script?: string;
  flutter?: { fvm?: boolean; flavor?: boolean; defineFile?: string };
  mobile?: { iosBundleId?: string; androidPackage?: string };
  lambda?: { handler?: string; runtime?: string } & Record<string, unknown>;
  sam?: { template?: string; envs?: Record<string, string | string[]> };
  /** The setting (or settings) that lists the browser origins this API allows. */
  cors?: { env?: string | string[] };
}
