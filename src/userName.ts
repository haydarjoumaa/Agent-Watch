import { execFileSync } from 'child_process';
import * as os from 'os';

// Login names that aren't anyone's real name.
const GENERIC_LOGINS = new Set(['root', 'admin', 'administrator', 'sysadmin', 'user', 'ubuntu', 'dev', 'developer', 'vagrant', 'codespace', 'node']);

/** "haydar jomaa" -> "Haydar"; empty if it doesn't look like a name. */
export function firstName(full: string | undefined): string {
  const first = (full ?? '').trim().split(/\s+/)[0] ?? '';
  if (!/^\p{L}[\p{L}'-]*$/u.test(first)) return '';
  return first[0].toUpperCase() + first.slice(1);
}

/** Best guess at what to call the user: Git's user.name, else a non-generic login name. */
export function detectUserName(): string {
  try {
    const gitName = execFileSync('git', ['config', '--global', '--get', 'user.name'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const name = firstName(gitName);
    if (name) return name;
  } catch {
    // No git or no name configured.
  }
  try {
    const login = os.userInfo().username;
    if (!GENERIC_LOGINS.has(login.toLowerCase())) return firstName(login);
  } catch {
    // No user info available.
  }
  return '';
}
