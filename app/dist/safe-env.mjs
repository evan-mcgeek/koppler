// The environment for a process that holds a secret. Whoever starts Koppler (a person, a script, an agent) decides its
// environment, and some variables make a runtime load extra code or send a database client to another host: with
// those set, the process would hand its secrets to the caller. So they are taken out, and the database clients are
// found in fixed places, never through the caller's PATH.
import fs from 'node:fs';
// Variables that make a runtime run code of the caller's choosing.
const LOADS_CODE = [/^NODE_OPTIONS$/, /^NODE_PATH$/, /^DYLD_/, /^LD_/, /^DOTNET_STARTUP_HOOKS$/, /^DOTNET_ADDITIONAL_DEPS$/, /^DOTNET_SHARED_STORE$/,
    /^(CORECLR|COR)_(ENABLE_PROFILING|PROFILER)/, /^BASH_ENV$/, /^ENV$/, /^PROMPT_COMMAND$/, /^PYTHON(STARTUP|PATH|HOME|INSPECT)$/, /^RUBY(OPT|LIB)$/,
    /^PERL5(OPT|LIB)$/, /^JAVA_TOOL_OPTIONS$/, /^_JAVA_OPTIONS$/, /^JDK_JAVA_OPTIONS$/];
// Variables that tell a database client where to connect or how; the connection comes only from the stored value.
const STEERS_CLIENT = [/^PG[A-Z]+$/, /^MYSQL_[A-Z_]+$/, /^LIBMYSQL_[A-Z_]+$/];
export const loadsCode = name => LOADS_CODE.some(p => p.test(name));
const without = (env, patterns) => Object.fromEntries(Object.entries(env).filter(([k]) => !patterns.some(p => p.test(k))));
// For an app started with its secrets; also says which variables were left out.
export function appEnv(env = process.env) {
    const kept = without(env, LOADS_CODE);
    return { env: kept, dropped: Object.keys(env).filter(k => !(k in kept)) };
}
// For a database client: the caller's environment without anything that steers it, plus what Koppler sets.
export const clientEnv = (own, env = process.env) => ({ ...without(env, [...LOADS_CODE, ...STEERS_CLIENT]), ...own });
// For a runner that holds an app's stored secrets (KOPPLER_SECRET_NAMES lists them): hands over the values and takes
// them out of the environment, so the tools it starts never carry them.
export function takeSecrets(env = process.env) {
    const taken = {};
    for (const name of (env.KOPPLER_SECRET_NAMES ?? '').split(' ').filter(Boolean)) {
        taken[name] = env[name];
        delete env[name];
    }
    return taken;
}
// A database client from where it is installed (Homebrew, the system), not from whatever is first on the PATH.
export function findClient(name, formula) {
    const places = [`/opt/homebrew/opt/${formula}/bin`, `/usr/local/opt/${formula}/bin`, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
    return places.map(d => `${d}/${name}`).find(p => { try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
    }
    catch {
        return false;
    } }) ?? null;
}
//# sourceMappingURL=safe-env.mjs.map